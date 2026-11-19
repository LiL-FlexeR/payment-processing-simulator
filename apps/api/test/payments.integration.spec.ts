import { randomUUID } from 'node:crypto';
import { jest } from '@jest/globals';
import { INestApplication, Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Pool } from 'pg';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { DatabaseService } from '../src/shared/database/database.service.js';
import { configureHttp } from '../src/shared/http/configure-http.js';
import { PaymentStatusService } from '../src/modules/payments/services/payment-status.service.js';
import { PaymentsService } from '../src/modules/payments/services/payments.service.js';
import {
  InvalidPaymentTransition,
  type ValidatedPaymentObservation,
} from '../src/modules/payments/payment-state-machine.js';
import { encodeCursor } from '../src/modules/payments/payment-validation.js';
import { assertTestDatabase } from './test-database.js';

assertTestDatabase();

describe('Payment Core with real PostgreSQL and concurrent HTTP', () => {
  let app: INestApplication;
  let other: INestApplication;
  let db: DatabaseService;
  let status: PaymentStatusService;
  let logs: ReturnType<typeof jest.spyOn>;
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 3 });
  const body = { amount: 2500, currency: 'USD' } as const;
  const create = (
    key: string = randomUUID(),
    payload: unknown = body,
    target = app,
  ) =>
    request(target.getHttpServer())
      .post('/api/v1/payments')
      .set('Idempotency-Key', key)
      .set('Content-Type', 'application/json')
      .send(JSON.stringify(payload));
  const counts = async () => [
    await db.payment.count(),
    await db.idempotencyRecord.count(),
    await db.paymentEvent.count(),
  ];
  const observe = (id: string, phase: ValidatedPaymentObservation['phase']) =>
    db.$transaction((tx) => status.apply(tx, id, { phase, source: 'test' }));

  beforeAll(async () => {
    logs = jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => undefined);
    async function start() {
      const module = await Test.createTestingModule({
        imports: [AppModule],
      }).compile();
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
    status = app.get(PaymentStatusService);
  });
  beforeEach(async () => {
    await pool.query(
      'TRUNCATE idempotency_records, payment_events, payments RESTART IDENTITY',
    );
    logs.mockClear();
  });
  afterAll(async () => {
    await pool.query(
      'TRUNCATE idempotency_records, payment_events, payments RESTART IDENTITY',
    );
    await app.close();
    await other.close();
    await pool.end();
    logs.mockRestore();
  });

  it('persists the exact 201 snapshot, stable operation key and initial audit atomically', async () => {
    const key = randomUUID();
    const response = await create(key, {
      currency: ' usd ',
      amount: 2500,
    }).expect(201);
    expect(response.body).toEqual({
      id: expect.any(String),
      amount: 2500,
      currency: 'USD',
      status: 'CREATED',
      createdAt: expect.any(String),
    });
    expect(response.headers).toMatchObject({
      location: `/api/v1/payments/${response.body.id}`,
      'idempotency-replayed': 'false',
      'cache-control': 'no-store',
      'x-request-id': expect.any(String),
    });
    expect(await counts()).toEqual([1, 1, 1]);
    const payment = await db.payment.findUniqueOrThrow({
      where: { id: response.body.id },
    });
    expect(payment).toMatchObject({
      status: 'CREATED',
      statusVersion: 1,
      provisioningStatus: 'NOT_STARTED',
      providerOperationKey: `pps:pi:create:v1:${payment.id}`,
    });
    const record = await db.idempotencyRecord.findUniqueOrThrow({
      where: { paymentId: payment.id },
    });
    expect(record).toMatchObject({
      scope: 'demo:create-payment:v1',
      key,
      responseStatus: 201,
      responseBody: response.body,
    });
    const events = await request(app.getHttpServer())
      .get(`${response.headers.location}/events`)
      .expect(200);
    expect(events.body).toEqual({
      items: [
        {
          id: expect.any(String),
          paymentId: payment.id,
          type: 'PAYMENT_CREATED',
          fromStatus: null,
          toStatus: 'CREATED',
          statusVersion: 1,
          webhookEventId: null,
          details: { source: 'api' },
          createdAt: expect.any(String),
        },
      ],
      nextCursor: null,
    });
  });

  it.each([1, 2, 3])(
    'ten simultaneous same-key HTTP requests across separate pools converge, run %s',
    async () => {
      const key = randomUUID();
      expect(other.get(DatabaseService)).not.toBe(db);
      const pids = await Promise.all(
        [db, other.get(DatabaseService)].map((connection) =>
          connection.$transaction(async (tx) => {
            const rows = await tx.$queryRaw<
              { pid: number }[]
            >`SELECT pg_backend_pid() AS pid`;
            await tx.$queryRaw`SELECT pg_sleep(0.02)::text`;
            return rows[0]!.pid;
          }),
        ),
      );
      expect(new Set(pids).size).toBe(2);
      const responses = await Promise.all(
        Array.from({ length: 10 }, (_, index) =>
          create(key, body, index % 2 ? app : other),
        ),
      );
      expect(responses.map((response) => response.status)).toEqual(
        Array(10).fill(201),
      );
      expect(
        new Set(responses.map((response) => JSON.stringify(response.body)))
          .size,
      ).toBe(1);
      expect(
        responses.filter(
          (response) => response.headers['idempotency-replayed'] === 'false',
        ),
      ).toHaveLength(1);
      expect(
        responses.filter(
          (response) => response.headers['idempotency-replayed'] === 'true',
        ),
      ).toHaveLength(9);
      expect(await counts()).toEqual([1, 1, 1]);
    },
  );

  it('replays normalized equivalents, rejects changed amount/currency, and separates intentional keys', async () => {
    const key = randomUUID();
    const original = await create(key).expect(201);
    await create(key, { currency: 'usd', amount: 2500 })
      .expect('Idempotency-Replayed', 'true')
      .expect(201, original.body);
    const conflict = await create(key, { ...body, amount: 2600 }).expect(409);
    expect(conflict.body.error).toMatchObject({
      code: 'IDEMPOTENCY_KEY_REUSED',
      retryable: false,
      details: null,
    });
    await create(key, { ...body, currency: 'EUR' }).expect(409);
    await create(key.toUpperCase()).expect(201);
    await create(randomUUID()).expect(201);
    expect(await counts()).toEqual([3, 3, 3]);
  });

  it('safely arbitrates simultaneous conflicting payloads with no orphans', async () => {
    const key = randomUUID();
    const responses = await Promise.all(
      Array.from({ length: 10 }, (_, index) =>
        create(
          key,
          { ...body, amount: index % 2 ? 2600 : 2500 },
          index % 2 ? app : other,
        ),
      ),
    );
    expect(
      responses.filter((response) => response.status === 201),
    ).toHaveLength(5);
    expect(
      responses.filter((response) => response.status === 409),
    ).toHaveLength(5);
    const winners = responses.filter((response) => response.status === 201);
    expect(
      new Set(winners.map((response) => JSON.stringify(response.body))).size,
    ).toBe(1);
    expect(await counts()).toEqual([1, 1, 1]);
  });

  it.each(['payment_events', 'idempotency_records'])(
    'rolls back all preceding writes when %s insertion fails',
    async (table) => {
      const key = randomUUID();
      await pool.query(
        "CREATE FUNCTION stage2_fail_write() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'private injected database fault'; END $$",
      );
      // table is an internal fixed test parameter, never request input.
      await pool.query(
        `CREATE TRIGGER stage2_fail BEFORE INSERT ON ${table} FOR EACH ROW EXECUTE FUNCTION stage2_fail_write()`,
      );
      try {
        const failed = await create(key).expect(500);
        expect(failed.text).not.toContain('private injected');
        expect(await counts()).toEqual([0, 0, 0]);
      } finally {
        await pool.query(`DROP TRIGGER stage2_fail ON ${table}`);
        await pool.query('DROP FUNCTION stage2_fail_write()');
      }
      await create(key).expect('Idempotency-Replayed', 'false').expect(201);
      expect(await counts()).toEqual([1, 1, 1]);
    },
  );

  it('keeps the original snapshot after a status change while GET returns current state', async () => {
    const key = randomUUID();
    const original = await create(key).expect(201);
    await observe(original.body.id, 'SUCCEEDED');
    await create(key)
      .expect('Idempotency-Replayed', 'true')
      .expect(201, original.body);
    const details = await request(app.getHttpServer())
      .get(original.headers.location!)
      .expect(200);
    expect(details.body).toEqual({
      ...original.body,
      status: 'SUCCEEDED',
      updatedAt: expect.any(String),
      statusVersion: 2,
      provisioningStatus: 'NOT_STARTED',
      stripePaymentIntentId: null,
      providerStatus: null,
      lastSyncedAt: null,
      nextProviderRetryAt: null,
      lastProviderErrorCode: null,
    });
    expect(await counts()).toEqual([1, 1, 2]);
  });

  it('applies every transition category and no-op through the transaction-aware helper', async () => {
    const phases = {
      PENDING: 'AWAITING_PAYMENT',
      FAILED: 'DECLINED',
      SUCCEEDED: 'SUCCEEDED',
      CANCELED: 'CANCELED',
    } as const;
    const allowed = new Set([
      'CREATED:PENDING',
      'CREATED:FAILED',
      'CREATED:SUCCEEDED',
      'CREATED:CANCELED',
      'PENDING:FAILED',
      'PENDING:SUCCEEDED',
      'PENDING:CANCELED',
      'FAILED:PENDING',
      'FAILED:SUCCEEDED',
      'FAILED:CANCELED',
    ]);
    for (const from of [
      'CREATED',
      'PENDING',
      'FAILED',
      'SUCCEEDED',
      'CANCELED',
    ] as const) {
      for (const to of Object.keys(phases) as (keyof typeof phases)[]) {
        const created = await app
          .get(PaymentsService)
          .create(randomUUID(), body);
        const id = created.body.id;
        if (from !== 'CREATED') await observe(id, phases[from]);
        const before = await db.payment.findUniqueOrThrow({ where: { id } });
        const eventCount = await db.paymentEvent.count({
          where: { paymentId: id },
        });
        if (from === to || allowed.has(`${from}:${to}`)) {
          const updated = await observe(id, phases[to]);
          expect(updated.status).toBe(to);
          expect(updated.statusVersion).toBe(
            before.statusVersion + (from === to ? 0 : 1),
          );
          expect(
            await db.paymentEvent.count({ where: { paymentId: id } }),
          ).toBe(eventCount + (from === to ? 0 : 1));
          if (from === to) expect(updated.updatedAt).toEqual(before.updatedAt);
        } else {
          await expect(observe(id, phases[to])).rejects.toThrow(
            InvalidPaymentTransition,
          );
          expect(await db.payment.findUnique({ where: { id } })).toEqual(
            before,
          );
          expect(
            await db.paymentEvent.count({ where: { paymentId: id } }),
          ).toBe(eventCount);
        }
      }
    }
  });

  it('rolls status and audit back together and serializes simultaneous observations', async () => {
    const created = await create().expect(201);
    const id = created.body.id;
    await expect(
      db.$transaction(async (tx) => {
        await status.apply(tx, id, { phase: 'SUCCEEDED', source: 'test' });
        throw new Error('fail immediately before commit');
      }),
    ).rejects.toThrow('fail immediately before commit');
    expect(await db.payment.findUnique({ where: { id } })).toMatchObject({
      status: 'CREATED',
      statusVersion: 1,
    });
    expect(await counts()).toEqual([1, 1, 1]);
    await pool.query(
      "CREATE FUNCTION stage2_fail_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.type = 'PAYMENT_STATUS_CHANGED' THEN RAISE EXCEPTION 'audit write failed'; END IF; RETURN NEW; END $$",
    );
    await pool.query(
      'CREATE TRIGGER stage2_fail BEFORE INSERT ON payment_events FOR EACH ROW EXECUTE FUNCTION stage2_fail_audit()',
    );
    try {
      await expect(observe(id, 'SUCCEEDED')).rejects.toThrow();
      expect(await db.payment.findUnique({ where: { id } })).toMatchObject({
        status: 'CREATED',
        statusVersion: 1,
      });
      expect(await counts()).toEqual([1, 1, 1]);
    } finally {
      await pool.query('DROP TRIGGER stage2_fail ON payment_events');
      await pool.query('DROP FUNCTION stage2_fail_audit()');
    }
    await Promise.all([
      observe(id, 'SUCCEEDED'),
      other
        .get(DatabaseService)
        .$transaction((tx) =>
          other
            .get(PaymentStatusService)
            .apply(tx, id, { phase: 'SUCCEEDED', source: 'test' }),
        ),
    ]);
    expect(await db.payment.findUnique({ where: { id } })).toMatchObject({
      status: 'SUCCEEDED',
      statusVersion: 2,
    });
    expect(await counts()).toEqual([1, 1, 2]);
    await expect(observe(id, 'UNSUPPORTED')).rejects.toThrow(
      InvalidPaymentTransition,
    );
    expect(await counts()).toEqual([1, 1, 2]);
  });

  it.each([
    { amount: '2500', currency: 'USD' },
    { amount: 99, currency: 'USD' },
    { amount: 1000001, currency: 'USD' },
    { amount: 100.5, currency: 'USD' },
    { amount: null, currency: 'USD' },
    { amount: true, currency: 'USD' },
    { amount: 100, currency: 'GBP' },
    { amount: 100, currency: ['USD'] },
    { ...body, status: 'SUCCEEDED' },
    {},
    [],
    null,
  ])('rejects invalid payload %j without persistence', async (payload) => {
    await create(randomUUID(), payload)
      .set('Content-Type', 'application/json')
      .expect(400);
    expect(await counts()).toEqual([0, 0, 0]);
  });

  it('rejects missing, malformed, oversized and duplicate singleton headers before writes', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/payments')
      .send(body)
      .expect(400);
    for (const key of [
      'short',
      'x'.repeat(129),
      'invalid key spaces',
      'a,b,c,0123456789',
    ])
      await create(key).expect(400);
    for (const header of ['Idempotency-Key', 'X-Request-Id', 'Content-Type']) {
      await create()
        .set(header, [randomUUID(), randomUUID()] as unknown as string)
        .expect(400);
    }
    expect(await counts()).toEqual([0, 0, 0]);
  });

  it('bounds/parses JSON and maps errors with safe correlation and no leaked values', async () => {
    const id = randomUUID();
    const malformed = await request(app.getHttpServer())
      .post('/api/v1/payments')
      .set('Content-Type', 'application/json')
      .set('X-Request-Id', id)
      .send('{"private-secret":')
      .expect('X-Request-Id', id)
      .expect('Cache-Control', 'no-store')
      .expect(400);
    expect(malformed.body.error).toEqual({
      code: 'VALIDATION_ERROR',
      message: 'Malformed JSON.',
      requestId: id,
      retryable: false,
      details: null,
    });
    await request(app.getHttpServer())
      .post('/api/v1/payments')
      .set('Content-Type', 'text/plain')
      .send('private-secret')
      .expect(415);
    const oversized = await create(randomUUID(), {
      ...body,
      secret: 'x'.repeat(16384),
    }).expect(413);
    expect(oversized.body.error.code).toBe('PAYLOAD_TOO_LARGE');
    const key = 'never-log-this-key-0123';
    await create(key, { ...body, secret: 'private-secret' }).expect(400);
    const serializedLogs = JSON.stringify(logs.mock.calls);
    expect(serializedLogs).not.toContain(key);
    expect(serializedLogs).not.toContain('private-secret');
    expect(serializedLogs).not.toContain(process.env.DATABASE_URL!);
    expect(serializedLogs).toContain('http_request');
    expect(serializedLogs).toContain(id);
    expect(await counts()).toEqual([0, 0, 0]);
  });

  it('independently enforces SQL money/currency/version/key checks, FKs and audit uniqueness', async () => {
    for (const [amount, currency, version, operationKey, code] of [
      [99, 'USD', 1, null, '23514'],
      [1000001, 'USD', 1, null, '23514'],
      ['100.5', 'USD', 1, null, '22P02'],
      [100, 'usd', 1, null, '23514'],
      [100, 'GBP', 1, null, '23514'],
      [100, 'USD', 0, null, '23514'],
      [100, 'USD', 1, 'replacement-key', '23514'],
    ] as const) {
      const id = randomUUID();
      await expect(
        pool.query(
          'INSERT INTO payments (id, amount, currency, status_version, provider_operation_key) VALUES ($1,$2,$3,$4,$5)',
          [
            id,
            amount,
            currency,
            version,
            operationKey ?? `pps:pi:create:v1:${id}`,
          ],
        ),
      ).rejects.toMatchObject({ code });
    }
    expect(await counts()).toEqual([0, 0, 0]);
    const created = await create().expect(201);
    const id = created.body.id;
    await expect(
      pool.query('DELETE FROM payments WHERE id=$1', [id]),
    ).rejects.toMatchObject({ code: '23503' });
    await expect(
      pool.query(
        "INSERT INTO payment_events (payment_id,type,to_status,status_version,details) VALUES ($1,'PAYMENT_CREATED','CREATED',1,'{}')",
        [id],
      ),
    ).rejects.toMatchObject({ code: '23505' });
    await expect(
      pool.query(
        "INSERT INTO payment_events (payment_id,type,to_status,status_version,details) VALUES ($1,'PAYMENT_CREATED','CREATED',1,'{}')",
        [randomUUID()],
      ),
    ).rejects.toMatchObject({ code: '23503' });
    await expect(
      pool.query(
        "INSERT INTO idempotency_records (id,scope,key,request_hash,payment_id,response_status,response_body) VALUES ($1,'demo:create-payment:v1',$2,$3,$4,201,'{}')",
        [randomUUID(), randomUUID(), 'a'.repeat(64), randomUUID()],
      ),
    ).rejects.toMatchObject({ code: '23503' });
    await pool.query(
      "INSERT INTO payment_events (payment_id,type,details) VALUES ($1,'SYNC_NO_CHANGE','{}'),($1,'SYNC_NO_CHANGE','{}')",
      [id],
    );
    expect(
      await db.paymentEvent.count({
        where: { paymentId: id, statusVersion: null },
      }),
    ).toBe(2);
  });

  it('paginates tied timestamps by descending UUID and checks filter/cursor boundaries', async () => {
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) ids.push((await create().expect(201)).body.id);
    await pool.query(
      "UPDATE payments SET created_at='2026-11-19T01:00:00.000Z'",
    );
    const sorted = [...ids].sort().reverse();
    const received: string[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 3; page++) {
      const response: request.Response = await request(app.getHttpServer())
        .get('/api/v1/payments')
        .query({ limit: 2, ...(cursor ? { cursor } : {}) })
        .expect(200);
      received.push(
        ...response.body.items.map((item: { id: string }) => item.id),
      );
      cursor = response.body.nextCursor;
    }
    expect(received).toEqual(sorted);
    expect(cursor).toBeNull();
    const exhausted = await request(app.getHttpServer())
      .get('/api/v1/payments')
      .query({
        cursor: encodeCursor({
          id: sorted.at(-1),
          createdAt: '2026-11-19T01:00:00.000Z',
          status: null,
        }),
      })
      .expect(200);
    expect(exhausted.body).toEqual({ items: [], nextCursor: null });
    await observe(ids[0]!, 'SUCCEEDED');
    const filtered = await request(app.getHttpServer())
      .get('/api/v1/payments?status=SUCCEEDED')
      .expect(200);
    expect(filtered.body.items.map((item: { id: string }) => item.id)).toEqual([
      ids[0],
    ]);
    const filteredPage = await request(app.getHttpServer())
      .get('/api/v1/payments?status=CREATED&limit=1')
      .expect(200);
    await request(app.getHttpServer())
      .get('/api/v1/payments')
      .query({ cursor: filteredPage.body.nextCursor, status: 'SUCCEEDED' })
      .expect(400);
  });

  it('serializes bigint event IDs exactly and uses strict descending event pagination with allowlists', async () => {
    await pool.query(
      "SELECT setval(pg_get_serial_sequence('payment_events','id'),9007199254740992)",
    );
    const created = await create().expect(201);
    const id = created.body.id;
    await observe(id, 'AWAITING_PAYMENT');
    await observe(id, 'DECLINED');
    await pool.query(
      "INSERT INTO payment_events (payment_id,type,details) VALUES ($1,'SYNC_NO_CHANGE',$2)",
      [
        id,
        {
          source: 'test',
          clientSecret: 'never-return-this',
          leaseToken: 'internal',
        },
      ],
    );
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const response: request.Response = await request(app.getHttpServer())
        .get(`/api/v1/payments/${id}/events`)
        .query({ limit: 1, ...(cursor ? { cursor } : {}) })
        .expect(200);
      expect(response.text).not.toContain('never-return-this');
      expect(response.text).not.toContain('leaseToken');
      seen.push(response.body.items[0].id);
      cursor = response.body.nextCursor;
    } while (cursor);
    expect(seen).toEqual([
      '9007199254740996',
      '9007199254740995',
      '9007199254740994',
      '9007199254740993',
    ]);
    await request(app.getHttpServer())
      .get(`/api/v1/payments/${id}/events`)
      .query({ cursor: encodeCursor({ id: seen.at(-1) }) })
      .expect(200, { items: [], nextCursor: null });
  });

  it('validates read IDs, unknown/duplicate queries, limits, cursors and body absence', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/payments/not-a-uuid')
      .expect(400);
    const missing = await request(app.getHttpServer())
      .get(`/api/v1/payments/${randomUUID()}`)
      .expect(404);
    expect(missing.body.error.code).toBe('PAYMENT_NOT_FOUND');
    await request(app.getHttpServer())
      .get(`/api/v1/payments/${randomUUID()}/events`)
      .expect(404);
    const created = await create().expect(201);
    const location = created.headers.location!;
    for (const suffix of [
      '?unknown=private-secret',
      '?limit=0',
      '?limit=101',
      '?limit=1.1',
      '?limit=2&limit=3',
      '?status=created',
      '?status=CREATED&status=FAILED',
      '?cursor=invalid',
      '?cursor=' + 'a'.repeat(1025),
    ])
      await request(app.getHttpServer())
        .get('/api/v1/payments' + suffix)
        .expect(400);
    await request(app.getHttpServer())
      .get(location + '?unknown=1')
      .expect(400);
    await request(app.getHttpServer())
      .get(location + '/events?status=CREATED')
      .expect(400);
    await request(app.getHttpServer())
      .get(location + '/events?cursor=' + encodeCursor({ id: '0' }))
      .expect(400);
    for (const path of ['/api/v1/payments', location, location + '/events'])
      await request(app.getHttpServer())
        .get(path)
        .send({ unexpected: true })
        .expect(400);
    const details = await request(app.getHttpServer())
      .get(location)
      .expect(200);
    expect(Object.keys(details.body).sort()).toEqual(
      [
        'id',
        'amount',
        'currency',
        'status',
        'createdAt',
        'updatedAt',
        'statusVersion',
        'provisioningStatus',
        'stripePaymentIntentId',
        'providerStatus',
        'lastSyncedAt',
        'nextProviderRetryAt',
        'lastProviderErrorCode',
      ].sort(),
    );
    expect(details.text).not.toContain('providerOperationKey');
    const summary = await request(app.getHttpServer())
      .get('/api/v1/payments')
      .expect(200);
    expect(Object.keys(summary.body.items[0]).sort()).toEqual(
      [
        'id',
        'amount',
        'currency',
        'status',
        'createdAt',
        'updatedAt',
        'statusVersion',
        'provisioningStatus',
      ].sort(),
    );
    await request(app.getHttpServer())
      .post(location + '/status')
      .send({ status: 'SUCCEEDED' })
      .expect(404);
    await request(app.getHttpServer())
      .post(location + '/confirmation-session')
      .send({})
      .expect(404);
  });

  it('generates local Swagger from DTOs for exactly the four payment routes', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/docs-json')
      .expect(200);
    expect(
      Object.keys(response.body.paths)
        .filter((path) => path.includes('payments'))
        .sort(),
    ).toEqual([
      '/api/v1/payments',
      '/api/v1/payments/{id}',
      '/api/v1/payments/{id}/events',
    ]);
    expect(
      response.body.components.schemas.CreatePaymentDto.additionalProperties,
    ).toBe(false);
    expect(
      response.body.components.schemas.CreationRepresentationDto.properties
        .status.enum,
    ).toEqual(['CREATED']);
    expect(
      response.body.paths['/api/v1/payments'].post.responses['201'].headers[
        'Idempotency-Replayed'
      ],
    ).toBeDefined();
    await request(app.getHttpServer()).get('/api/docs/').expect(200);
  });
});
