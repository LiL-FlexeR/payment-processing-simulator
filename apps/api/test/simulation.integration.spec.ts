import { randomUUID } from 'node:crypto';
import { jest } from '@jest/globals';
import { type INestApplication, Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Pool } from 'pg';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { FakePaymentProvider } from '../src/integrations/fake/fake-payment.provider.js';
import { PAYMENT_PROVIDER } from '../src/integrations/payment-provider.token.js';
import {
  ConfigService,
  parseConfig,
} from '../src/shared/config/config.service.js';
import { DatabaseService } from '../src/shared/database/database.service.js';
import { configureHttp } from '../src/shared/http/configure-http.js';
import { assertTestDatabase } from './test-database.js';

assertTestDatabase();
describe('Stage 4 guarded HTTP simulations on PostgreSQL', () => {
  let app: INestApplication;
  let db: DatabaseService;
  let fake: FakePaymentProvider;
  let log: ReturnType<typeof jest.spyOn>;
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const config = { ...parseConfig(process.env), apiPort: 3101 };
  const post = (path: string, body: object) =>
    request(app.getHttpServer())
      .post(`/api/v1/dev/simulations/${path}`)
      .set('Authorization', `Bearer ${config.simulationToken}`)
      .send(body);
  const payment = async () =>
    (
      await request(app.getHttpServer())
        .post('/api/v1/payments')
        .set('Idempotency-Key', randomUUID())
        .send({ amount: 2500, currency: 'USD' })
        .expect(201)
    ).body.id as string;
  const session = (id: string) =>
    request(app.getHttpServer())
      .post(`/api/v1/payments/${id}/confirmation-session`)
      .send({});
  const details = (id: string) =>
    db.payment.findUniqueOrThrow({ where: { id } });
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
  beforeAll(async () => {
    log = jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => undefined);
    fake = new FakePaymentProvider(config);
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ConfigService)
      .useValue(new ConfigService(config))
      .overrideProvider(PAYMENT_PROVIDER)
      .useValue(fake)
      .compile();
    app = module.createNestApplication({ bodyParser: false, logger: false });
    configureHttp(app);
    await app.listen(3101, '127.0.0.1');
    db = app.get(DatabaseService);
  });
  beforeEach(async () => {
    await pool.query(
      'TRUNCATE payment_events,webhook_events,idempotency_records,payments RESTART IDENTITY CASCADE',
    );
  });
  afterAll(async () => {
    await app?.close();
    await pool.query(
      'TRUNCATE payment_events,webhook_events,idempotency_records,payments RESTART IDENTITY CASCADE',
    );
    await pool.end();
    log?.mockRestore();
  });
  it.each(['duplicate_request', 'concurrent_requests'])(
    '%s reports real requests, one payment and one creation event',
    async (scenario) => {
      const report = (
        await post('request-race', {
          scenario,
          amount: 2500,
          currency: 'usd',
        }).expect(200)
      ).body;
      expect(report.uniquePaymentCount).toBe(1);
      expect(report.creationEventCount).toBe(1);
      expect(report.responseStatuses).toEqual(
        Array(scenario === 'duplicate_request' ? 2 : 10).fill(201),
      );
      expect(new Set(report.paymentIds).size).toBe(1);
      expect(await db.payment.count()).toBe(1);
    },
  );
  it('rejects missing/wrong/duplicated bearer, unknown fields, bad money/media/query; cannot inject status or target URL', async () => {
    const path = '/api/v1/dev/simulations/request-race';
    for (const token of ['', 'Bearer wrong'])
      await request(app.getHttpServer())
        .post(path)
        .set('Authorization', token)
        .send({})
        .expect(403);
    await request(app.getHttpServer())
      .post(path)
      .set('Authorization', [
        `Bearer ${config.simulationToken}`,
        `Bearer ${config.simulationToken}`,
      ] as unknown as string)
      .send({})
      .expect(400);
    for (const body of [
      { scenario: 'success' },
      { scenario: 'duplicate_request', amount: 1, currency: 'USD' },
      {
        scenario: 'duplicate_request',
        amount: 2500,
        currency: 'USD',
        target: 'http://foreign',
      },
    ])
      await post('request-race', body).expect(400);
    await post('request-race?url=foreign', {
      scenario: 'duplicate_request',
      amount: 2500,
      currency: 'USD',
    }).expect(400);
    await request(app.getHttpServer())
      .post(path)
      .set('Authorization', `Bearer ${config.simulationToken}`)
      .set('Content-Type', 'text/plain')
      .send('{}')
      .expect(415);
  });
  it('fake decline then success reuses the intent, signed replay adds no transition and immutable conflicts are rejected', async () => {
    const id = await payment();
    await session(id).expect(200);
    const intent = (await details(id)).stripePaymentIntentId;
    const decline = (
      await post(`payments/${id}/confirm`, { scenario: 'decline' }).expect(200)
    ).body;
    expect(decline.deliveryStatus).toBe(200);
    expect((await details(id)).status).toBe('FAILED');
    await session(id).expect(200);
    const success = (
      await post(`payments/${id}/confirm`, { scenario: 'success' }).expect(200)
    ).body;
    expect((await details(id)).stripePaymentIntentId).toBe(intent);
    expect((await details(id)).status).toBe('SUCCEEDED');
    const replay = (
      await post(`webhooks/${success.eventId}/replay`, {
        deliveries: 2,
      }).expect(200)
    ).body;
    expect(replay).toMatchObject({
      deliveryStatuses: [200, 200],
      storedDeliveryCount: 3,
      processingStatus: 'PROCESSED',
      financialTransitionCount: 1,
    });
    await post(`payments/${id}/confirm`, { scenario: 'decline' }).expect(409);
    await session(id).expect(409);
    const original = fake.fixtures.get(success.eventId)!;
    const changed = JSON.parse(original.toString());
    changed.created++;
    fake.fixtures.set(success.eventId, Buffer.from(JSON.stringify(changed)));
    await post(`webhooks/${success.eventId}/replay`, { deliveries: 2 }).expect(
      400,
    );
    expect(
      (
        await db.webhookEvent.findUniqueOrThrow({
          where: { id: success.eventId },
        })
      ).deliveryCount,
    ).toBe(3);
    fake.fixtures.set(success.eventId, original);
    const raw = Buffer.concat([original, Buffer.from('\n')]);
    await request(app.getHttpServer())
      .post('/api/v1/webhooks/stripe')
      .set('Content-Type', 'application/json')
      .set('Stripe-Signature', fake.sign(original))
      .send(raw.toString())
      .expect(400);
  });
  it('one-shot rollback keeps status/audit/receipt unfinished, then signed replay recovers atomically', async () => {
    const id = await payment();
    await session(id).expect(200);
    const armed = (
      await post(`payments/${id}/fault`, {
        point: 'webhook_before_commit',
      }).expect(200)
    ).body;
    expect(
      (
        await post(`payments/${id}/fault`, {
          point: 'webhook_before_commit',
        }).expect(200)
      ).body,
    ).toEqual(armed);
    await post(`payments/${id}/fault`, {
      point: 'provider_response_timeout',
    }).expect(409);
    const outcome = (
      await post(`payments/${id}/confirm`, { scenario: 'success' }).expect(200)
    ).body;
    expect(outcome.deliveryStatus).toBe(503);
    expect((await details(id)).status).toBe('PENDING');
    expect(
      await db.paymentEvent.count({
        where: {
          webhookEventId: outcome.eventId,
          type: 'PAYMENT_STATUS_CHANGED',
        },
      }),
    ).toBe(0);
    expect(
      (
        await db.webhookEvent.findUniqueOrThrow({
          where: { id: outcome.eventId },
        })
      ).status,
    ).toBe('RETRYABLE');
    await eligible(id, outcome.eventId);
    const replay = (
      await post(`webhooks/${outcome.eventId}/replay`, {
        deliveries: 2,
      }).expect(200)
    ).body;
    expect(replay.deliveryStatuses).toEqual([200, 200]);
    expect(replay.financialTransitionCount).toBe(1);
    expect((await details(id)).status).toBe('SUCCEEDED');
  });
  it('discarded provider-create response recovers the same provider object and frozen operation', async () => {
    const id = await payment();
    const before = fake.intents.size;
    await post(`payments/${id}/fault`, {
      point: 'provider_response_timeout',
    }).expect(200);
    const failed = await session(id).expect(503);
    expect(failed.body.error.code).toBe('PROVIDER_OUTCOME_UNKNOWN');
    expect((await details(id)).status).toBe('CREATED');
    expect((await details(id)).stripePaymentIntentId).toBeNull();
    expect(fake.intents.size).toBe(before + 1);
    const operation = fake.operations.get(
      (await details(id)).providerOperationKey,
    )!;
    await eligible(id);
    await session(id).expect(200);
    expect((await details(id)).stripePaymentIntentId).toBe(operation.id);
    expect(fake.intents.size).toBe(before + 1);
    expect(JSON.stringify(log.mock.calls)).not.toContain('_secret_');
    expect(JSON.stringify(log.mock.calls)).not.toContain(
      config.simulationToken,
    );
  });
  it('fake confirmation is rejected in Stripe mode and active payment leases block synthetic changes', async () => {
    const id = await payment();
    await session(id).expect(200);
    Object.defineProperty(fake, 'name', {
      value: 'stripe',
      configurable: true,
    });
    try {
      await post(`payments/${id}/confirm`, { scenario: 'success' }).expect(404);
    } finally {
      Object.defineProperty(fake, 'name', {
        value: 'fake',
        configurable: true,
      });
    }
    await pool.query(
      "UPDATE payments SET lease_token=gen_random_uuid(),lease_expires_at=clock_timestamp()+interval '30 seconds' WHERE id=$1",
      [id],
    );
    await post(`payments/${id}/confirm`, { scenario: 'success' }).expect(409);
    expect((await details(id)).status).toBe('PENDING');
  });
});
