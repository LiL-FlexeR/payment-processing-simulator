import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';

const env = {
  ...process.env,
  ...parseEnv(readFileSync('../api/.env.test', 'utf8')),
};
const db = new URL(env.DATABASE_URL ?? '');
if (
  env.NODE_ENV !== 'test' ||
  !db.pathname.endsWith('_test') ||
  !['localhost', '127.0.0.1'].includes(db.hostname) ||
  db.port !== '5433'
)
  throw new Error(
    'Browser tests require the isolated loopback _test PostgreSQL database on port 5433.',
  );
Object.assign(env, {
  SIMULATOR_E2E: 'true',
  PAYMENT_PROVIDER: 'fake',
  SIMULATION_ENABLED: 'true',
  SIMULATION_TOKEN: 'test_simulation_token_0123456789abcdef',
  TEST_WEBHOOK_SECRET: 'whsec_fake_0123456789abcdef0123456789abcdef',
  API_PORT: '3102',
  WEB_ORIGIN: 'http://localhost:3000',
  API_INTERNAL_ORIGIN: 'http://127.0.0.1:3102',
  PAYMENT_RETURN_URL: 'http://localhost:3000/payments/return',
});
const migrate = spawnSync(
  process.execPath,
  ['../../node_modules/prisma/build/index.js', 'migrate', 'deploy'],
  { cwd: '../api', env, stdio: 'inherit' },
);
if (migrate.status !== 0) process.exit(migrate.status ?? 1);
const result = spawnSync(
  process.execPath,
  [
    '../../node_modules/@playwright/test/cli.js',
    'test',
    ...process.argv.slice(2),
  ],
  { env, stdio: 'inherit' },
);
process.exitCode = result.status ?? 1;
