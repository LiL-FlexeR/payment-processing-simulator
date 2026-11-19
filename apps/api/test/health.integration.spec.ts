import { jest } from '@jest/globals';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { DatabaseService } from '../src/shared/database/database.service.js';
import {
  ConfigService,
  parseConfig,
} from '../src/shared/config/config.service.js';
import { configureHttp } from '../src/shared/http/configure-http.js';

// Refuse to touch the development database, even if a caller selects the wrong file.
const testUrl = new URL(process.env.DATABASE_URL ?? '');
if (
  process.env.NODE_ENV !== 'test' ||
  !testUrl.pathname.endsWith('_test') ||
  !['localhost', '127.0.0.1'].includes(testUrl.hostname) ||
  testUrl.port !== '5433'
)
  throw new Error(
    'Integration tests require NODE_ENV=test and a separate loopback database ending in _test on port 5433.',
  );

describe('real PostgreSQL readiness, without domain migrations', () => {
  let app: INestApplication;
  let database: DatabaseService;
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = module.createNestApplication();
    configureHttp(app);
    await app.init();
    database = app.get(DatabaseService);
  });
  afterAll(async () => {
    await app.close();
  });

  it('reads an empty database through the actual HTTP and Prisma pipeline', async () => {
    const tables = await database.$queryRaw<
      { count: bigint }[]
    >`SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`;
    expect(tables[0]?.count).toBe(0n);
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
      await request(isolated.getHttpServer())
        .get('/api/v1/health/live')
        .expect(200);
    } finally {
      output.mockRestore();
      await isolated.close();
    }
  });
});
