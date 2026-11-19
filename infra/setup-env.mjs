import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const templates = [
  ['.env.example', '.env'],
  ['apps/api/.env.example', 'apps/api/.env'],
  ['apps/api/test/.env.example', 'apps/api/.env.test'],
  ['apps/web/.env.example', 'apps/web/.env.local'],
];
if (templates.some(([, target]) => existsSync(new URL(target, root)))) {
  console.error(
    'Local environment files already exist and were preserved. Use the .env.example files to update them manually.',
  );
  process.exitCode = 1;
} else {
  const password = randomBytes(24).toString('hex');
  const instanceId = randomUUID();
  for (const [template, target] of templates) {
    const contents = readFileSync(new URL(template, root), 'utf8')
      .replaceAll('REPLACE_WITH_RANDOM_HEX', password)
      .replaceAll('REPLACE_WITH_UUID', instanceId);
    writeFileSync(fileURLToPath(new URL(target, root)), contents, {
      flag: 'wx',
      mode: 0o600,
    });
  }
  console.log(
    'Created ignored local environment files with a random password and stable instance UUID.',
  );
}
