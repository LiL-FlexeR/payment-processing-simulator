import { jest } from '@jest/globals';
import { INestApplication, Logger } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { Prisma } from '../src/generated/prisma/client.js';
import { PaymentsService } from '../src/modules/payments/services/payments.service.js';
import {
  ConfigService,
  parseConfig,
} from '../src/shared/config/config.service.js';
import { DatabaseService } from '../src/shared/database/database.service.js';
import { configureHttp } from '../src/shared/http/configure-http.js';

describe('payment HTTP infrastructure', () => {
  let app: INestApplication;
  const create = jest.fn<PaymentsService['create']>();
  const snapshot = {
    id: '9d576a31-e423-4422-9a4c-c1346ad6534e',
    amount: 100,
    currency: 'USD',
    status: 'CREATED',
    createdAt: '2026-11-19T01:00:00.000Z',
  } as const;
  let logs: ReturnType<typeof jest.spyOn>;
  async function start(nodeEnv = 'test') {
    const config = new ConfigService(
      parseConfig({
        NODE_ENV: nodeEnv,
        DATABASE_URL:
          'postgresql://user:private-password@127.0.0.1:5433/simulator_test',
        WEB_ORIGIN: 'http://localhost:3000',
        APP_INSTANCE_ID: '2c1063a4-ce83-4e82-a152-5bacd5c255df',
      }),
    );
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ConfigService)
      .useValue(config)
      .overrideProvider(DatabaseService)
      .useValue({ isReady: async () => true })
      .overrideProvider(PaymentsService)
      .useValue({ create })
      .compile();
    app = module.createNestApplication({ bodyParser: false, logger: false });
    configureHttp(app);
    await app.init();
  }
  beforeEach(() => {
    create.mockReset().mockResolvedValue({ body: snapshot, replayed: false });
    logs = jest
      .spyOn(Logger.prototype, 'log')
      .mockImplementation(() => undefined);
  });
  afterEach(async () => {
    await app?.close();
    logs.mockRestore();
  });
  const post = (path = '/api/v1/payments') =>
    request(app.getHttpServer())
      .post(path)
      .set('Idempotency-Key', 'a'.repeat(16))
      .send({ amount: 100, currency: 'USD' });

  it('returns Retry-After for write throttling, including a trailing-slash route', async () => {
    await start();
    for (let count = 0; count < 120; count++) await post().expect(201);
    const throttled = await post('/api/v1/payments/').expect(429);
    expect(throttled.body.error).toMatchObject({
      code: 'RATE_LIMITED',
      retryable: true,
    });
    expect(Number(throttled.headers['retry-after'])).toBeGreaterThanOrEqual(1);
    expect(create).toHaveBeenCalledTimes(120);
  });
  it('maps unavailable storage to a retryable 503 and hides arbitrary failures', async () => {
    await start();
    create.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('private-secret', {
        code: 'P2024',
        clientVersion: '7.10.1',
      }),
    );
    const unavailable = await post().expect('Retry-After', '1').expect(503);
    expect(unavailable.body.error.code).toBe('DATABASE_UNAVAILABLE');
    expect(unavailable.text).not.toContain('private-secret');
    create.mockRejectedValueOnce(new Error('private-secret'));
    const failure = await post().expect(500);
    expect(failure.body.error.code).toBe('INTERNAL_ERROR');
    expect(failure.text).not.toContain('private-secret');
    expect(JSON.stringify(logs.mock.calls)).not.toContain('private-secret');
  });
  it('rejects wrong media types on equivalent routes and unsupported JSON encodings', async () => {
    await start();
    await request(app.getHttpServer())
      .post('/api/v1/payments/')
      .set('Content-Type', 'text/plain')
      .send('private-secret')
      .expect(415);
    await request(app.getHttpServer())
      .post('/api/v1/payments')
      .set('Content-Type', 'application/json; charset=iso-8859-1')
      .send('{}')
      .expect(415);
    expect(create).not.toHaveBeenCalled();
  });
  it('does not register Swagger in production', async () => {
    await start('production');
    await request(app.getHttpServer()).get('/api/docs').expect(404);
    await request(app.getHttpServer()).get('/api/docs-json').expect(404);
  });
});
