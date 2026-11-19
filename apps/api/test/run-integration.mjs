import { spawnSync } from 'node:child_process';

const url = new URL(process.env.DATABASE_URL ?? '');
if (
  process.env.NODE_ENV !== 'test' ||
  !url.pathname.endsWith('_test') ||
  !['localhost', '127.0.0.1'].includes(url.hostname) ||
  url.port !== '5433'
) {
  throw new Error(
    'Refusing integration setup: use NODE_ENV=test and a separate loopback database ending in _test on port 5433.',
  );
}
for (const args of [
  ['../../node_modules/prisma/build/index.js', 'generate'],
  ['../../node_modules/prisma/build/index.js', 'migrate', 'deploy'],
  ['../../node_modules/@nestjs/cli/bin/nest.js', 'build'],
  [
    '--experimental-vm-modules',
    '../../node_modules/jest/bin/jest.js',
    '--runInBand',
    '--testPathPatterns=\\.integration\\.spec\\.ts$',
  ],
]) {
  const result = spawnSync(process.execPath, args, {
    stdio: 'inherit',
    env: process.env,
  });
  if (result.error || result.status !== 0) {
    process.exitCode = result.status ?? 1;
    break;
  }
}
