import { jest } from '@jest/globals';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import {
  ConfigService,
  parseConfig,
} from '../src/shared/config/config.service.js';
import { configureHttp } from '../src/shared/http/configure-http.js';
import { assertTestDatabase } from './test-database.js';

// Refuse to touch the development database, even if a caller selects the wrong file.
assertTestDatabase();

describe('real PostgreSQL readiness', () => {
  let app: INestApplication;
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = module.createNestApplication();
    configureHttp(app);
    await app.init();
  });
  afterAll(async () => {
    await app.close();
  });

  it('probes PostgreSQL through the actual HTTP and Prisma pipeline after migrations', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/health/ready')
      .expect(200, { status: 'ready', database: 'up' });
  });

  it('bounds actual unreachable-database probes and sanitizes errors/logs', async () => {
    const config = new ConfigService(
      parseConfig({
        ...process.env,
        DATABASE_URL:
          'postgresql://user:must-not-appear@127.0.0.1:1/unreachable_test',
      }),
    );
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ConfigService)
      .useValue(config)
      .compile();
    const isolated = module.createNestApplication();
    configureHttp(isolated);
    await isolated.init();
    const output = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    const started = Date.now();
    try {
      const response = await request(isolated.getHttpServer())
        .get('/api/v1/health/ready')
        .expect(503, { status: 'not_ready', database: 'down' });
      expect(Date.now() - started).toBeLessThan(2500);
      expect(response.text).not.toContain('must-not-appear');
      expect(JSON.stringify(output.mock.calls)).not.toContain(
        'must-not-appear',
      );
      const paymentFailure = await request(isolated.getHttpServer())
        .get('/api/v1/payments')
        .expect('Retry-After', '1')
        .expect(503);
      expect(paymentFailure.body.error).toMatchObject({
        code: 'DATABASE_UNAVAILABLE',
        retryable: true,
        details: null,
      });
      expect(paymentFailure.text).not.toContain('must-not-appear');
      await request(isolated.getHttpServer())
        .get('/api/v1/health/live')
        .expect(200);
    } finally {
      output.mockRestore();
      await isolated.close();
    }
  });
});
