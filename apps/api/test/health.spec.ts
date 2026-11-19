import { fakeEnv } from './provider-env.js';
import { jest } from '@jest/globals';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import {
  ConfigService,
  parseConfig,
} from '../src/shared/config/config.service.js';
import { DatabaseService } from '../src/shared/database/database.service.js';
import { configureHttp } from '../src/shared/http/configure-http.js';

describe('health HTTP contract', () => {
  let app: INestApplication;
  const database = { isReady: jest.fn<() => Promise<boolean>>() };
  const config = new ConfigService(
    parseConfig({
      ...fakeEnv,
      NODE_ENV: 'test',
      DATABASE_URL:
        'postgresql://user:private-password@127.0.0.1:5433/simulator_test',
      WEB_ORIGIN: 'http://localhost:3000',
      APP_INSTANCE_ID: '2c1063a4-ce83-4e82-a152-5bacd5c255df',
    }),
  );

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ConfigService)
      .useValue(config)
      .overrideProvider(DatabaseService)
      .useValue(database)
      .compile();
    app = module.createNestApplication();
    configureHttp(app);
    await app.init();
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(() => {
    database.isReady.mockReset().mockResolvedValue(true);
  });

  it('checks process liveness without touching persistence', async () => {
    const id = 'd447ea8a-8948-40d2-962a-3f9d19e1345b';
    await request(app.getHttpServer())
      .get('/api/v1/health/live')
      .set('X-Request-Id', id)
      .expect('Cache-Control', 'no-store')
      .expect('X-Request-Id', id)
      .expect(200, { status: 'ok' });
    expect(database.isReady).not.toHaveBeenCalled();
  });
  it('returns the exact readiness success schema', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/health/ready')
      .expect(200, { status: 'ready', database: 'up' });
  });
  it('returns a safe 503 and keeps liveness up during a database outage', async () => {
    database.isReady.mockResolvedValue(false);
    await request(app.getHttpServer())
      .get('/api/v1/health/ready')
      .expect(503, { status: 'not_ready', database: 'down' });
    await request(app.getHttpServer())
      .get('/api/v1/health/live')
      .expect(200, { status: 'ok' });
  });
  it.each(['live', 'ready'])('rejects query and body on %s', async (probe) => {
    const response = await request(app.getHttpServer())
      .get(`/api/v1/health/${probe}?secret=private-password`)
      .expect(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(response.text).not.toContain('private-password');
    await request(app.getHttpServer())
      .get(`/api/v1/health/${probe}`)
      .send({ unexpected: true })
      .expect(400);
  });
  it('replaces an untrusted request ID and hides implementation headers', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/health/live')
      .set('X-Request-Id', 'not-a-uuid')
      .expect(200);
    expect(response.headers['x-request-id']).toMatch(/^[a-f0-9-]{36}$/);
    expect(response.headers['x-powered-by']).toBeUndefined();
  });
  it('does not expose unexpected exception messages', async () => {
    database.isReady.mockRejectedValue(new Error(config.values.databaseUrl));
    const response = await request(app.getHttpServer())
      .get('/api/v1/health/ready')
      .expect(500);
    expect(response.text).not.toContain('private-password');
    expect(response.body.error.code).toBe('INTERNAL_ERROR');
  });
});
