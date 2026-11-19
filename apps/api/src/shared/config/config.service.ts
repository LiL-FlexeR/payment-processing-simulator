import { Injectable } from '@nestjs/common';

export interface AppConfig {
  nodeEnv: 'development' | 'test' | 'production';
  apiPort: number;
  databaseUrl: string;
  webOrigin: string;
  appInstanceId: string;
}

export function parseConfig(env: NodeJS.ProcessEnv): AppConfig {
  const invalid: string[] = [];
  const nodeEnv = env.NODE_ENV ?? 'development';
  if (!['development', 'test', 'production'].includes(nodeEnv))
    invalid.push('NODE_ENV');
  const apiPort = Number(env.API_PORT ?? '3001');
  if (
    !/^\d+$/.test(env.API_PORT ?? '3001') ||
    !Number.isInteger(apiPort) ||
    apiPort < 1 ||
    apiPort > 65535
  )
    invalid.push('API_PORT (1–65535)');
  try {
    const url = new URL(env.DATABASE_URL ?? '');
    if (
      !['postgresql:', 'postgres:'].includes(url.protocol) ||
      !url.hostname ||
      !url.username ||
      !url.password ||
      url.pathname.length < 2 ||
      url.hash
    )
      throw new Error();
  } catch {
    invalid.push(
      'DATABASE_URL (PostgreSQL URL with credentials and database name)',
    );
  }
  try {
    const url = new URL(env.WEB_ORIGIN ?? '');
    if (
      url.protocol !== 'http:' ||
      !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
      url.port !== '3000' ||
      url.origin !== env.WEB_ORIGIN
    )
      throw new Error();
  } catch {
    invalid.push('WEB_ORIGIN (exact local HTTP origin on port 3000)');
  }
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      env.APP_INSTANCE_ID ?? '',
    )
  )
    invalid.push('APP_INSTANCE_ID (stable UUID)');
  if (
    env.PAYMENT_PROVIDER ||
    (env.SIMULATION_ENABLED && env.SIMULATION_ENABLED !== 'false')
  )
    invalid.push(
      'PAYMENT_PROVIDER / SIMULATION_ENABLED (unavailable before Stage 3)',
    );
  if (invalid.length)
    throw new Error(
      `Invalid configuration: ${invalid.join(', ')}. Check the environment examples; values are not logged.`,
    );
  return {
    nodeEnv: nodeEnv as AppConfig['nodeEnv'],
    apiPort,
    databaseUrl: env.DATABASE_URL!,
    webOrigin: env.WEB_ORIGIN!,
    appInstanceId: env.APP_INSTANCE_ID!,
  };
}

@Injectable()
export class ConfigService {
  constructor(readonly values: Readonly<AppConfig>) {}
}
