import { randomUUID } from 'node:crypto';
import { jest } from '@jest/globals';
import { type INestApplication, Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Pool } from 'pg';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { FakePaymentProvider } from '../src/integrations/fake/fake-payment.provider.js';
import { PAYMENT_PROVIDER } from '../src/integrations/payment-provider.token.js';
import { ProviderFailure } from '../src/integrations/payment-provider.types.js';
import { PaymentLeaseService } from '../src/modules/payments/services/payment-lease.service.js';
import {
  ConfigService,
  parseConfig,
} from '../src/shared/config/config.service.js';
import { DatabaseService } from '../src/shared/database/database.service.js';
import { localTransaction } from '../src/shared/database/local-transaction.js';
import { configureHttp } from '../src/shared/http/configure-http.js';
import { assertTestDatabase } from './test-database.js';

assertTestDatabase();
function gate() {
  let open!: () => void;
  const promise = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { promise, open };
}

describe('Stage 3 signed provider synchronization with real PostgreSQL', () => {
  let app: INestApplication;
  let other: INestApplication;
  let db: DatabaseService;
  let fake: FakePaymentProvider;
  let logs: ReturnType<typeof jest.spyOn>;
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 3 });
  const post = (id: string, operation = 'confirmation-session', target = app) =>
    request(target.getHttpServer())
      .post(`/api/v1/payments/${id}/${operation}`)
      .send({});
  const create = async () =>
    (
      await request(app.getHttpServer())
        .post('/api/v1/payments')
        .set('Idempotency-Key', randomUUID())
        .send({ amount: 2500, currency: 'USD' })
        .expect(201)
    ).body.id as string;
  const payment = (id: string) =>
    db.payment.findUniqueOrThrow({ where: { id } });
  const hook = (event: { raw: Buffer; signature: string }, target = app) =>
    request(target.getHttpServer())
      .post('/api/v1/webhooks/stripe')
      .set('Content-Type', 'application/json')
      .set('Stripe-Signature', event.signature)
      .send(event.raw.toString());
  const receipt = (id: string) =>
    db.webhookEvent.findUniqueOrThrow({ where: { id } });
  async function eligible(id: string, eventId?: string) {
    await pool.query(
      'UPDATE payments SET next_provider_retry_at=NULL WHERE id=$1',
      [id],
    );
    if (eventId)
      await pool.query(
        'UPDATE webhook_events SET next_retry_at=NULL WHERE id=$1',
        [eventId],
      );
  }
  async function linked() {
    const id = await create();
    const session = await post(id).expect(200);
    const intent = (await payment(id)).stripePaymentIntentId!;
    return { id, intent, session };
  }
  beforeAll(async () => {
    logs = jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => undefined);
    fake = new FakePaymentProvider(parseConfig(process.env));
    async function start() {
      const module = await Test.createTestingModule({ imports: [AppModule] })
        .overrideProvider(PAYMENT_PROVIDER)
        .useValue(fake)
        .compile();
      const application = module.createNestApplication({
        bodyParser: false,
        logger: false,
      });
      configureHttp(application);
      await application.init();
      return application;
    }
    app = await start();
    other = await start();
    db = app.get(DatabaseService);
  });
  beforeEach(async () => {
    await pool.query(
      'TRUNCATE idempotency_records, payment_events, webhook_events, payments RESTART IDENTITY',
    );
    fake.intents.clear();
    fake.operations.clear();
    fake.fixtures.clear();
    fake.createCalls = 0;
    fake.retrieveCalls = 0;
    fake.loseNextCreateResponse = false;
    fake.nextFailure = null;
    fake.beforeRetrieve = null;
    logs.mockClear();
  });
  afterAll(async () => {
    await pool.query(
      'TRUNCATE idempotency_records, payment_events, webhook_events, payments RESTART IDENTITY',
    );
    await app.close();
    await other.close();
    await pool.end();
    logs.mockRestore();
  });

  it('racing confirmation sessions across independent pools create one intent and a committed link before secrets', async () => {
    const id = await create();
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, n) =>
        post(id, 'confirmation-session', n % 2 ? app : other),
      ),
    );
    expect(results.some((result) => result.status === 200)).toBe(true);
    expect(results.every((result) => [200, 409].includes(result.status))).toBe(
      true,
    );
    expect(fake.createCalls).toBe(1);
    expect(fake.operations.size).toBe(1);
    const stored = await payment(id);
    expect(stored).toMatchObject({
      status: 'PENDING',
      statusVersion: 2,
      provisioningStatus: 'READY',
      createAttemptCount: 1,
      leaseToken: null,
    });
    for (const result of results) {
      if (result.status === 200)
        expect(result.body.clientSecret).toContain(
          stored.stripePaymentIntentId,
        );
      else expect(result.body.error.code).toBe('OPERATION_IN_PROGRESS');
      expect(result.headers['cache-control']).toBe('no-store');
    }
    expect(
      await db.paymentEvent.count({
        where: { paymentId: id, type: 'PAYMENT_STATUS_CHANGED' },
      }),
    ).toBe(1);
    const frozen = structuredClone(stored.providerCreateParams);
    await post(id).expect(200);
    expect((await payment(id)).providerCreateParams).toEqual(frozen);
    expect(fake.createCalls).toBe(1);
    expect(JSON.stringify(logs.mock.calls)).not.toContain('_secret_');
    for (const path of ['', '/events']) {
      const details = await request(app.getHttpServer())
        .get(`/api/v1/payments/${id}${path}`)
        .expect(200);
      expect(details.text).not.toContain('_secret_');
      expect(details.text).not.toContain('leaseToken');
      expect(details.text).not.toContain('providerCreateParams');
    }
  });

  it('recovers a lost create response with the same key, frozen parameters and first-attempt time', async () => {
    const id = await create();
    fake.loseNextCreateResponse = true;
    const failed = await post(id).expect(503);
    expect(failed.body.error.code).toBe('PROVIDER_OUTCOME_UNKNOWN');
    const before = await payment(id);
    expect(before).toMatchObject({
      status: 'CREATED',
      stripePaymentIntentId: null,
      provisioningStatus: 'RETRYABLE',
      createAttemptCount: 1,
    });
    expect(before.firstProviderRequestAt).not.toBeNull();
    await post(id).expect('Retry-After', /[1-9]/).expect(409);
    expect(fake.createCalls).toBe(1);
    await eligible(id);
    await post(id).expect(200);
    const after = await payment(id);
    expect(after.stripePaymentIntentId).toBe([...fake.intents.keys()][0]);
    expect(after.providerCreateParams).toEqual(before.providerCreateParams);
    expect(after.firstProviderRequestAt).toEqual(before.firstProviderRequestAt);
    expect(after.providerOperationKey).toBe(before.providerOperationKey);
    expect(after.createAttemptCount).toBe(2);
    expect(fake.operations.size).toBe(1);
  });

  it('never reveals a secret after a linkage/audit commit failure and recovers the accepted external operation', async () => {
    const id = await create();
    await pool.query(
      "CREATE FUNCTION stage3_fail_link() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.stripe_payment_intent_id IS NOT NULL THEN RAISE EXCEPTION 'fail link'; END IF; RETURN NEW; END $$",
    );
    await pool.query(
      'CREATE TRIGGER stage3_fail_link BEFORE UPDATE ON payments FOR EACH ROW EXECUTE FUNCTION stage3_fail_link()',
    );
    try {
      const result = await post(id).expect(500);
      expect(result.text).not.toContain('_secret_');
      expect(await payment(id)).toMatchObject({
        status: 'CREATED',
        stripePaymentIntentId: null,
        statusVersion: 1,
      });
      expect(
        await db.paymentEvent.count({
          where: { paymentId: id, statusVersion: { not: null } },
        }),
      ).toBe(1);
    } finally {
      await pool.query('DROP TRIGGER stage3_fail_link ON payments');
      await pool.query('DROP FUNCTION stage3_fail_link()');
    }
    await eligible(id);
    await post(id).expect(200);
    expect(fake.operations.size).toBe(1);
    expect(fake.createCalls).toBe(2);
  });

  it('a signed webhook links an unknown create before a late response; late owner cannot reveal its secret', async () => {
    const id = await create();
    const accepted = gate();
    const finish = gate();
    const original = fake.createIntent.bind(fake);
    const spy = jest
      .spyOn(fake, 'createIntent')
      .mockImplementation(async (params, key) => {
        const result = await original(params, key);
        accepted.open();
        await finish.promise;
        return result;
      });
    const pending = post(id).then((response) => response);
    try {
      await accepted.promise;
      const intent = [...fake.intents.keys()][0]!;
      const event = fake.confirm(intent, 'success');
      await hook(event).expect(503); // Busy, receipt exists but unfinished.
      expect((await receipt(event.id)).status).toBe('RECEIVED');
      await pool.query(
        "UPDATE payments SET lease_expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",
        [id],
      );
      await hook(event, other).expect(200);
      expect(await payment(id)).toMatchObject({
        stripePaymentIntentId: intent,
        status: 'SUCCEEDED',
        statusVersion: 2,
      });
      finish.open();
      const late = await pending;
      expect(late.status).toBe(409);
      expect(late.text).not.toContain('_secret_');
      expect((await receipt(event.id)).deliveryCount).toBe(2);
    } finally {
      finish.open();
      await pending;
      spy.mockRestore();
    }
  });

  it('decline is retryable FAILED on the same intent; transport errors preserve financial state and later success clears the error', async () => {
    const { id, intent } = await linked();
    await hook(fake.confirm(intent, 'decline')).expect(200);
    expect(await payment(id)).toMatchObject({
      status: 'FAILED',
      lastProviderErrorCode: 'PAYMENT_DECLINED',
      provisioningStatus: 'READY',
    });
    await post(id).expect(200);
    fake.nextFailure = new ProviderFailure(
      'transient',
      'PROVIDER_UNAVAILABLE',
      'req_fakeTimeout',
    );
    await post(id, 'sync').expect(503);
    expect(await payment(id)).toMatchObject({
      status: 'FAILED',
      provisioningStatus: 'RETRYABLE',
      lastProviderErrorCode: 'PROVIDER_UNAVAILABLE',
    });
    await eligible(id);
    await hook(fake.confirm(intent, 'success')).expect(200);
    expect(await payment(id)).toMatchObject({
      status: 'SUCCEEDED',
      lastProviderErrorCode: null,
      provisioningStatus: 'READY',
      statusVersion: 4,
    });
    expect(fake.createCalls).toBe(1);
    const result = await post(id).expect(409);
    expect(result.body.error.code).toBe('PAYMENT_NOT_CONFIRMABLE');
  });

  it('sequential/concurrent redelivery and distinct same-state IDs do not duplicate transitions or receipts', async () => {
    const { id, intent } = await linked();
    const event = fake.confirm(intent, 'success');
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, n) => hook(event, n % 2 ? app : other)),
    );
    expect(results.every((r) => [200, 503].includes(r.status))).toBe(true);
    await hook(event).expect(200);
    const another = fake.event(intent, 'payment_intent.succeeded');
    await hook(another).expect(200);
    expect(await payment(id)).toMatchObject({
      status: 'SUCCEEDED',
      statusVersion: 3,
    });
    expect(
      await db.paymentEvent.count({
        where: { paymentId: id, type: 'PAYMENT_STATUS_CHANGED' },
      }),
    ).toBe(2);
    expect(await receipt(event.id)).toMatchObject({
      status: 'PROCESSED',
      deliveryCount: 11,
      processingAttempts: 1,
    });
    expect(await receipt(another.id)).toMatchObject({
      status: 'PROCESSED',
      processingHistory: expect.arrayContaining([
        expect.objectContaining({ outcome: 'NO_CHANGE' }),
      ]),
    });
    expect(
      await db.paymentEvent.count({
        where: { webhookEventId: event.id, statusVersion: { not: null } },
      }),
    ).toBe(1);
  });

  it('a T4 rollback leaves no partial financial/audit/receipt completion; signed redelivery recovers', async () => {
    const { id, intent } = await linked();
    const event = fake.confirm(intent, 'success');
    await pool.query(
      "CREATE FUNCTION stage3_fail_commit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.status='PROCESSED' THEN RAISE EXCEPTION 'fail just before completion'; END IF; RETURN NEW; END $$",
    );
    await pool.query(
      'CREATE TRIGGER stage3_fail_commit BEFORE UPDATE ON webhook_events FOR EACH ROW EXECUTE FUNCTION stage3_fail_commit()',
    );
    try {
      await hook(event).expect(503);
      expect(await payment(id)).toMatchObject({
        status: 'PENDING',
        statusVersion: 2,
        leaseToken: null,
      });
      expect(await receipt(event.id)).toMatchObject({
        status: 'RETRYABLE',
        processedAt: null,
        processingHistory: expect.arrayContaining([
          expect.objectContaining({ outcome: 'RETRYABLE' }),
        ]),
      });
      expect(
        await db.paymentEvent.count({
          where: { paymentId: id, type: 'PAYMENT_STATUS_CHANGED' },
        }),
      ).toBe(1);
    } finally {
      await pool.query('DROP TRIGGER stage3_fail_commit ON webhook_events');
      await pool.query('DROP FUNCTION stage3_fail_commit()');
    }
    await eligible(id, event.id);
    await hook(event).expect(200);
    await hook(event).expect(200);
    expect(await payment(id)).toMatchObject({
      status: 'SUCCEEDED',
      statusVersion: 3,
    });
    expect(await receipt(event.id)).toMatchObject({
      status: 'PROCESSED',
      deliveryCount: 3,
      processingAttempts: 2,
    });
  });

  it('delayed decline retrieves current success; contradictory terminal observation receives durable review, never a regression', async () => {
    const { id, intent } = await linked();
    const delayed = fake.confirm(intent, 'decline');
    await hook(fake.confirm(intent, 'success')).expect(200);
    await hook(delayed).expect(200);
    expect(await payment(id)).toMatchObject({
      status: 'SUCCEEDED',
      statusVersion: 3,
    });
    fake.intents.get(intent)!.phase = 'CANCELED';
    fake.intents.get(intent)!.providerStatus = 'canceled';
    const contradiction = fake.event(intent, 'payment_intent.canceled');
    await hook(contradiction).expect(200);
    expect(await payment(id)).toMatchObject({
      status: 'SUCCEEDED',
      statusVersion: 3,
      provisioningStatus: 'REVIEW_REQUIRED',
    });
    expect((await receipt(contradiction.id)).status).toBe('REVIEW_REQUIRED');
    const retrieves = fake.retrieveCalls;
    await hook(contradiction).expect(200);
    expect(fake.retrieveCalls).toBe(retrieves);
    fake.intents.get(intent)!.phase = 'SUCCEEDED';
    fake.intents.get(intent)!.providerStatus = 'succeeded';
    await post(id, 'sync').expect(200);
    expect((await payment(id)).provisioningStatus).toBe('READY');
    expect((await receipt(contradiction.id)).status).toBe('REVIEW_REQUIRED');
  });

  it('canceled stays terminal and sessions discovering processing/success commit observations without returning secrets', async () => {
    for (const [phase, status] of [
      ['PROCESSING', 'processing'],
      ['SUCCEEDED', 'succeeded'],
      ['CANCELED', 'canceled'],
    ] as const) {
      const { id, intent } = await linked();
      const external = fake.intents.get(intent)!;
      external.phase = phase;
      external.providerStatus = status;
      const result = await post(id).expect(409);
      expect(result.body.error.code).toBe('PAYMENT_NOT_CONFIRMABLE');
      expect(result.text).not.toContain('_secret_');
      expect((await payment(id)).providerStatus).toBe(status);
      if (phase === 'CANCELED') {
        external.phase = 'AWAITING_PAYMENT';
        external.providerStatus = 'requires_payment_method';
        await hook(fake.event(intent)).expect(200);
        expect(await payment(id)).toMatchObject({
          status: 'CANCELED',
          provisioningStatus: 'REVIEW_REQUIRED',
        });
      }
    }
  });

  it('expired/late retrieve owners cannot commit or release a replacement token; provider HTTP holds no transaction', async () => {
    const { id, intent } = await linked();
    const entered = gate();
    const finish = gate();
    fake.beforeRetrieve = async () => {
      const rows = await pool.query(
        "SELECT count(*) AS count FROM pg_stat_activity WHERE datname=current_database() AND state='idle in transaction'",
      );
      expect(rows.rows[0].count).toBe('0');
      entered.open();
      await finish.promise;
    };
    const pending = post(id, 'sync').then((r) => r);
    try {
      await entered.promise;
      await pool.query(
        "UPDATE payments SET lease_expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",
        [id],
      );
      const replacement = await other
        .get(PaymentLeaseService)
        .claim(id, 'sync');
      expect(replacement).not.toBeNull();
      finish.open();
      const stale = await pending;
      expect(stale.status).toBe(409);
      expect((await payment(id)).leaseToken).toBe(replacement!.token);
      await localTransaction(db, (tx) =>
        app.get(PaymentLeaseService).release(tx, replacement!),
      );
      fake.beforeRetrieve = null;
      fake.confirm(intent, 'success');
      await post(id, 'sync').expect(200);
      expect(await payment(id)).toMatchObject({
        status: 'SUCCEEDED',
        statusVersion: 3,
        leaseToken: null,
      });
    } finally {
      finish.open();
      await pending;
      fake.beforeRetrieve = null;
    }
  });

  it('late old observation cannot overwrite a newer committed success', async () => {
    const { id, intent } = await linked();
    const entered = gate();
    const finish = gate();
    fake.beforeRetrieve = async () => {
      entered.open();
      await finish.promise;
    };
    const pending = post(id, 'sync').then((r) => r);
    try {
      await entered.promise;
      fake.beforeRetrieve = null;
      await pool.query(
        "UPDATE payments SET lease_expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",
        [id],
      );
      fake.confirm(intent, 'success');
      await post(id, 'sync', other).expect(200);
      finish.open();
      expect((await pending).status).toBe(409);
      expect(await payment(id)).toMatchObject({
        status: 'SUCCEEDED',
        statusVersion: 3,
        leaseToken: null,
        provisioningStatus: 'READY',
      });
    } finally {
      finish.open();
      await pending;
      fake.beforeRetrieve = null;
    }
  });

  it('23-hour unlinked cutoff prevents creates while authentic correlated retrieval can still recover', async () => {
    const id = await create();
    fake.loseNextCreateResponse = true;
    await post(id).expect(503);
    await pool.query(
      "UPDATE payments SET first_provider_request_at=clock_timestamp()-interval '23 hours',next_provider_retry_at=NULL WHERE id=$1",
      [id],
    );
    expect((await post(id).expect(409)).body.error.code).toBe(
      'REVIEW_REQUIRED',
    );
    await post(id).expect(409);
    expect(fake.createCalls).toBe(1);
    expect((await post(id, 'sync').expect(409)).body.error.code).toBe(
      'PROVIDER_NOT_INITIALIZED',
    );
    const intent = [...fake.intents.keys()][0]!;
    await hook(fake.event(intent)).expect(200);
    await post(id).expect(200);
    await post(id, 'sync').expect(200);
    expect(fake.createCalls).toBe(1);
    expect((await payment(id)).provisioningStatus).toBe('READY');
  });

  it('six-create budget is persisted, longer provider Retry-After is honored, and blocked config never retries automatically', async () => {
    const id = await create();
    fake.nextFailure = new ProviderFailure(
      'transient',
      'PROVIDER_UNAVAILABLE',
      'req_rateLimit',
      10000,
    );
    await post(id).expect(503);
    const limited = await payment(id);
    expect(limited.nextProviderRetryAt!.getTime() - Date.now()).toBeGreaterThan(
      9000,
    );
    expect(
      Number((await post(id).expect(409)).headers['retry-after']),
    ).toBeGreaterThanOrEqual(9);
    await pool.query(
      'UPDATE payments SET create_attempt_count=5,next_provider_retry_at=NULL WHERE id=$1',
      [id],
    );
    fake.nextFailure = new ProviderFailure('transient', 'PROVIDER_UNAVAILABLE');
    await post(id).expect(409);
    await post(id).expect(409);
    expect(fake.createCalls).toBe(2);
    expect((await payment(id)).createAttemptCount).toBe(6);
    const blocked = await create();
    fake.nextFailure = new ProviderFailure(
      'blocked',
      'PROVIDER_CONFIGURATION_ERROR',
    );
    await post(blocked).expect(502);
    await post(blocked).expect(502);
    expect(await payment(blocked)).toMatchObject({
      status: 'CREATED',
      provisioningStatus: 'BLOCKED',
      createAttemptCount: 1,
    });
  });

  it.each([
    'amount',
    'currency',
    'livemode',
    'accountId',
    'metadata',
    'automaticCardWorkflow',
    'unsupported',
  ])(
    'permanent %s mismatch is durably reviewed without changing financial state',
    async (field) => {
      const { id, intent } = await linked();
      const external = fake.intents.get(intent)!;
      const event = fake.event(intent); // Envelope remains correctly signed/test-mode.
      if (field === 'amount') external.amount++;
      if (field === 'currency') external.currency = 'eur';
      if (field === 'livemode') external.livemode = true;
      if (field === 'accountId') external.accountId = 'acct_foreign';
      if (field === 'metadata') external.metadata.operation_key = 'different';
      if (field === 'automaticCardWorkflow')
        external.automaticCardWorkflow = false;
      if (field === 'unsupported') {
        external.phase = 'UNSUPPORTED';
        external.providerStatus = 'requires_capture';
      }
      await hook(event).expect(200);
      expect(await payment(id)).toMatchObject({
        status: 'PENDING',
        statusVersion: 2,
        provisioningStatus: 'REVIEW_REQUIRED',
      });
      expect((await receipt(event.id)).status).toBe('REVIEW_REQUIRED');
    },
  );

  it('records transient retrieve history and recovers without spending the create budget', async () => {
    const { id, intent } = await linked();
    const event = fake.confirm(intent, 'success');
    fake.nextFailure = new ProviderFailure(
      'transient',
      'PROVIDER_UNAVAILABLE',
      'req_transient',
    );
    await hook(event).expect(503);
    expect((await receipt(event.id)).status).toBe('RETRYABLE');
    expect(await payment(id)).toMatchObject({
      status: 'PENDING',
      createAttemptCount: 1,
    });
    await eligible(id, event.id);
    await hook(event).expect(200);
    expect((await receipt(event.id)).processingHistory).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ outcome: 'STARTED' }),
        expect.objectContaining({ outcome: 'RETRYABLE' }),
        expect.objectContaining({ outcome: 'PROCESSED' }),
      ]),
    );
    expect(fake.createCalls).toBe(1);
  });

  it('missing correlation stops after ten persisted attempts and does not implicitly reopen review', async () => {
    const { id, intent } = await linked();
    const raw = JSON.parse(fake.event(intent).raw.toString());
    raw.data.object.id = 'pi_fake_missing';
    const missing = randomUUID();
    raw.data.object.metadata.payment_id = missing;
    raw.data.object.metadata.operation_key = `pps:pi:create:v1:${missing}`;
    const bytes = Buffer.from(JSON.stringify(raw));
    const event = { raw: bytes, signature: fake.sign(bytes) };
    for (let n = 0; n < 10; n++) {
      await pool.query(
        'UPDATE webhook_events SET next_retry_at=NULL WHERE id=$1',
        [raw.id],
      );
      await hook(event).expect(n === 9 ? 200 : 503);
    }
    expect(await receipt(raw.id)).toMatchObject({
      status: 'REVIEW_REQUIRED',
      processingAttempts: 10,
      deliveryCount: 10,
      paymentId: null,
    });
    await hook(event).expect(200);
    expect((await receipt(raw.id)).processingAttempts).toBe(10);
    expect((await payment(id)).status).toBe('PENDING');
  });

  it('ignores unsupported and foreign-instance verified events; rejects immutable event-ID conflicts', async () => {
    const { id, intent } = await linked();
    const unsupported = fake.event(intent, 'charge.succeeded');
    await hook(unsupported).expect(200);
    expect(await receipt(unsupported.id)).toMatchObject({
      status: 'IGNORED',
      lastErrorCode: 'UNSUPPORTED_EVENT',
    });
    const raw = JSON.parse(fake.event(intent).raw.toString());
    raw.data.object.metadata.app_instance_id = randomUUID();
    const bytes = Buffer.from(JSON.stringify(raw));
    await hook({ raw: bytes, signature: fake.sign(bytes) }).expect(200);
    expect(await receipt(raw.id)).toMatchObject({
      status: 'IGNORED',
      lastErrorCode: 'FOREIGN_INSTANCE',
    });
    const conflict = JSON.parse(unsupported.raw.toString());
    conflict.type = 'charge.failed';
    const changed = Buffer.from(JSON.stringify(conflict));
    await hook({ raw: changed, signature: fake.sign(changed) }).expect(400);
    expect((await receipt(unsupported.id)).type).toBe('charge.succeeded');
    expect((await payment(id)).statusVersion).toBe(2);
  });

  it('rejects missing/wrong/expired/future signatures, raw-byte tampering, live/Connect/wrong-version/malformed envelopes before receipt writes', async () => {
    const { intent } = await linked();
    const event = fake.event(intent);
    await request(app.getHttpServer())
      .post('/api/v1/webhooks/stripe')
      .send(JSON.parse(event.raw.toString()))
      .expect(400);
    await hook({ ...event, signature: 't=1,v1=' + 'a'.repeat(64) }).expect(400);
    await hook({
      ...event,
      raw: Buffer.concat([event.raw, Buffer.from('\n')]),
    }).expect(400);
    for (const seconds of [-301, 301])
      await hook({
        ...event,
        signature: fake.sign(
          event.raw,
          Math.floor(Date.now() / 1000) + seconds,
        ),
      }).expect(400);
    const malformed = Buffer.from('{');
    await hook({ raw: malformed, signature: fake.sign(malformed) }).expect(400);
    for (const mutate of [
      (e: Record<string, unknown>) => {
        e.livemode = true;
      },
      (e: Record<string, unknown>) => {
        e.account = 'acct_foreign';
      },
      (e: Record<string, unknown>) => {
        e.api_version = 'wrong';
      },
      (e: Record<string, unknown>) => {
        e.data = {};
      },
    ]) {
      const raw = JSON.parse(event.raw.toString());
      mutate(raw);
      const bytes = Buffer.from(JSON.stringify(raw));
      await hook({ raw: bytes, signature: fake.sign(bytes) }).expect(400);
    }
    expect(await db.webhookEvent.count()).toBe(0);
    await hook({
      raw: Buffer.from('x'.repeat(256 * 1024 + 1)),
      signature: event.signature,
    }).expect(413);
    await hook(event).set('Content-Type', 'text/plain').expect(415);
    await hook(event).set('Content-Encoding', 'gzip').expect(415);
    await hook(event)
      .set('Content-Type', 'application/json; charset=iso-8859-1')
      .expect(415);
    await hook(event)
      .set('Stripe-Signature', [
        event.signature,
        event.signature,
      ] as unknown as string)
      .expect(400);
  });

  it('T2 receipt failure acknowledges nothing and a fresh redelivery can insert and process it', async () => {
    const { intent } = await linked();
    const event = fake.confirm(intent, 'success');
    await pool.query(
      "CREATE FUNCTION stage3_fail_receipt() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'receipt unavailable'; END $$",
    );
    await pool.query(
      'CREATE TRIGGER stage3_fail_receipt BEFORE INSERT ON webhook_events FOR EACH ROW EXECUTE FUNCTION stage3_fail_receipt()',
    );
    try {
      await hook(event).expect(500);
      expect(await db.webhookEvent.count()).toBe(0);
    } finally {
      await pool.query('DROP TRIGGER stage3_fail_receipt ON webhook_events');
      await pool.query('DROP FUNCTION stage3_fail_receipt()');
    }
    await hook(event).expect(200);
    expect((await receipt(event.id)).status).toBe('PROCESSED');
  });

  it('T3 claim failure leaves a durable RECEIVED receipt and no half-acquired lease', async () => {
    const { id, intent } = await linked();
    const event = fake.confirm(intent, 'success');
    await pool.query(
      "CREATE FUNCTION stage3_fail_claim() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.lease_token IS NOT NULL THEN RAISE EXCEPTION 'claim unavailable'; END IF; RETURN NEW; END $$",
    );
    await pool.query(
      'CREATE TRIGGER stage3_fail_claim BEFORE UPDATE ON payments FOR EACH ROW EXECUTE FUNCTION stage3_fail_claim()',
    );
    try {
      await hook(event).expect(503);
      expect(await receipt(event.id)).toMatchObject({
        status: 'RECEIVED',
        processingAttempts: 0,
      });
      expect(await payment(id)).toMatchObject({
        status: 'PENDING',
        leaseToken: null,
      });
    } finally {
      await pool.query('DROP TRIGGER stage3_fail_claim ON payments');
      await pool.query('DROP FUNCTION stage3_fail_claim()');
    }
    await hook(event).expect(200);
  });

  it('T5 failure-recording rollback remains unfinished until lease expiry and signed redelivery', async () => {
    const { id, intent } = await linked();
    const event = fake.confirm(intent, 'success');
    fake.nextFailure = new ProviderFailure('transient', 'PROVIDER_UNAVAILABLE');
    await pool.query(
      "CREATE FUNCTION stage3_fail_failure_record() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.status='RETRYABLE' THEN RAISE EXCEPTION 'failure record unavailable'; END IF; RETURN NEW; END $$",
    );
    await pool.query(
      'CREATE TRIGGER stage3_fail_failure_record BEFORE UPDATE ON webhook_events FOR EACH ROW EXECUTE FUNCTION stage3_fail_failure_record()',
    );
    try {
      await hook(event).expect(503);
      expect(await receipt(event.id)).toMatchObject({
        status: 'RECEIVED',
        processingAttempts: 1,
      });
      expect(await payment(id)).toMatchObject({
        status: 'PENDING',
        statusVersion: 2,
      });
    } finally {
      await pool.query(
        'DROP TRIGGER stage3_fail_failure_record ON webhook_events',
      );
      await pool.query('DROP FUNCTION stage3_fail_failure_record()');
    }
    await hook(event).expect(503);
    await pool.query(
      "UPDATE payments SET lease_expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",
      [id],
    );
    await hook(event).expect(200);
    expect((await receipt(event.id)).processingAttempts).toBe(2);
  });

  it('a fresh application instance reuses durable unfinished receipts and externally reseeded fake state', async () => {
    const { id, intent } = await linked();
    const event = fake.confirm(intent, 'success');
    await pool.query(
      "UPDATE payments SET lease_token=gen_random_uuid(),lease_expires_at=clock_timestamp()+interval '30 seconds' WHERE id=$1",
      [id],
    );
    await hook(event).expect(503);
    const reseeded = new FakePaymentProvider(parseConfig(process.env));
    for (const [key, value] of fake.intents)
      reseeded.intents.set(key, structuredClone(value));
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PAYMENT_PROVIDER)
      .useValue(reseeded)
      .compile();
    const restarted = module.createNestApplication({
      bodyParser: false,
      logger: false,
    });
    configureHttp(restarted);
    await restarted.init();
    try {
      await pool.query(
        "UPDATE payments SET lease_expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",
        [id],
      );
      await hook(event, restarted).expect(200);
      await hook(event, restarted).expect(200);
      expect(await payment(id)).toMatchObject({
        status: 'SUCCEEDED',
        statusVersion: 3,
      });
      expect(await receipt(event.id)).toMatchObject({
        status: 'PROCESSED',
        deliveryCount: 3,
        processingAttempts: 1,
      });
      expect(reseeded.createCalls).toBe(0);
      expect(reseeded.retrieveCalls).toBe(1);
    } finally {
      await restarted.close();
    }
  });

  it('enforces operation HTTP schemas, read-only GETs, receipt/identity constraints and sanitized persistence', async () => {
    const id = await create();
    for (const operation of ['confirmation-session', 'sync']) {
      await request(app.getHttpServer())
        .post(`/api/v1/payments/${id}/${operation}`)
        .send({ status: 'SUCCEEDED' })
        .expect(400);
      await request(app.getHttpServer())
        .post(`/api/v1/payments/${id}/${operation}`)
        .send('null')
        .set('Content-Type', 'application/json')
        .expect(400);
      await request(app.getHttpServer())
        .post(`/api/v1/payments/${id}/${operation}?target=success`)
        .send({})
        .expect(400);
      await post(randomUUID(), operation).expect(404);
      await post('invalid', operation).expect(400);
    }
    await post(id, 'sync').expect(409);
    expect(fake.createCalls).toBe(0);
    await post(id).expect(200);
    const intent = (await payment(id)).stripePaymentIntentId!;
    for (const sql of [
      "UPDATE payments SET stripe_payment_intent_id='pi_replacement' WHERE id=$1",
      "UPDATE payments SET provider_create_params='{}' WHERE id=$1",
      'UPDATE payments SET stripe_payment_intent_id=NULL WHERE id=$1',
      'UPDATE payments SET lease_token=gen_random_uuid() WHERE id=$1',
      'UPDATE payments SET create_attempt_count=7 WHERE id=$1',
    ])
      await expect(pool.query(sql, [id])).rejects.toMatchObject({
        code: '23514',
      });
    const raw = JSON.parse(fake.event(intent).raw.toString());
    raw.data.object.client_secret = 'never-persist-this';
    raw.data.object.metadata.sensitive = 'never-persist-this';
    const bytes = Buffer.from(JSON.stringify(raw));
    await hook({ raw: bytes, signature: fake.sign(bytes) }).expect(200);
    expect(JSON.stringify(await receipt(raw.id))).not.toContain(
      'never-persist-this',
    );
    const calls = fake.retrieveCalls;
    await request(app.getHttpServer())
      .get(`/api/v1/payments/${id}`)
      .expect(200);
    expect(fake.retrieveCalls).toBe(calls);
    expect(JSON.stringify(logs.mock.calls)).not.toContain('never-persist-this');
    expect(app.get(ConfigService).values.paymentProvider).toBe('fake');
  });
});
