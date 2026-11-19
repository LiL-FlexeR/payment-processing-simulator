import { Injectable } from '@nestjs/common';

export const STRIPE_API_VERSION = '2026-11-18.endive';

export interface AppConfig {
  nodeEnv: 'development' | 'test' | 'production';
  apiPort: number;
  databaseUrl: string;
  webOrigin: string;
  appInstanceId: string;
  paymentProvider: 'stripe' | 'fake';
  simulationEnabled: boolean;
  simulationToken: string;
  testWebhookSecret: string;
  stripeSecretKey: string;
  stripePublishableKey: string;
  stripeWebhookSecret: string;
  stripeAccountId: string;
  stripeApiVersion: typeof STRIPE_API_VERSION;
  paymentReturnUrl: string;
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
  const provider = env.PAYMENT_PROVIDER;
  if (!['stripe', 'fake'].includes(provider ?? ''))
    invalid.push('PAYMENT_PROVIDER');
  const simulationEnabled = env.SIMULATION_ENABLED === 'true';
  if (
    env.SIMULATION_ENABLED &&
    !['true', 'false'].includes(env.SIMULATION_ENABLED)
  )
    invalid.push('SIMULATION_ENABLED');
  if (nodeEnv === 'production' && (provider === 'fake' || simulationEnabled))
    invalid.push('PAYMENT_PROVIDER / SIMULATION_ENABLED (production)');
  if (
    simulationEnabled &&
    !/^[A-Za-z0-9_-]{32,}$/.test(env.SIMULATION_TOKEN ?? '')
  )
    invalid.push('SIMULATION_TOKEN');
  if (provider === 'fake') {
    if (!simulationEnabled)
      invalid.push('SIMULATION_ENABLED (required for fake)');
    if (!/^whsec_fake_[A-Za-z0-9_-]{32,}$/.test(env.TEST_WEBHOOK_SECRET ?? ''))
      invalid.push('TEST_WEBHOOK_SECRET');
    try {
      const url = new URL(env.DATABASE_URL ?? '');
      if (!url.pathname.endsWith('_test') && !url.pathname.endsWith('_fake'))
        throw new Error();
    } catch {
      invalid.push('DATABASE_URL (separate _test or _fake database for fake)');
    }
  }
  if (provider === 'stripe') {
    for (const [key, pattern] of [
      ['STRIPE_SECRET_KEY', /^sk_test_[A-Za-z0-9]+$/],
      ['NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY', /^pk_test_[A-Za-z0-9]+$/],
      ['STRIPE_WEBHOOK_SECRET', /^whsec_[A-Za-z0-9]+$/],
      ['STRIPE_ACCOUNT_ID', /^acct_[A-Za-z0-9]+$/],
    ] as const)
      if (!pattern.test(env[key] ?? '')) invalid.push(key);
    if (env.STRIPE_API_VERSION !== STRIPE_API_VERSION)
      invalid.push('STRIPE_API_VERSION');
    if (env.STRIPE_WEBHOOK_SECRET === env.TEST_WEBHOOK_SECRET)
      invalid.push('STRIPE_WEBHOOK_SECRET (must differ from fake)');
  }
  try {
    const url = new URL(env.PAYMENT_RETURN_URL ?? '');
    if (
      url.origin !== env.WEB_ORIGIN ||
      url.pathname !== '/payments/return' ||
      url.search ||
      url.hash ||
      url.username ||
      url.password
    )
      throw new Error();
  } catch {
    invalid.push('PAYMENT_RETURN_URL (fixed WEB_ORIGIN/payments/return)');
  }
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
    paymentProvider: provider as AppConfig['paymentProvider'],
    simulationEnabled,
    simulationToken: env.SIMULATION_TOKEN ?? '',
    testWebhookSecret: env.TEST_WEBHOOK_SECRET ?? '',
    stripeSecretKey: env.STRIPE_SECRET_KEY ?? '',
    stripePublishableKey: env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY ?? '',
    stripeWebhookSecret: env.STRIPE_WEBHOOK_SECRET ?? '',
    stripeAccountId: env.STRIPE_ACCOUNT_ID ?? '',
    stripeApiVersion: STRIPE_API_VERSION,
    paymentReturnUrl: env.PAYMENT_RETURN_URL!,
  };
}

@Injectable()
export class ConfigService {
  constructor(readonly values: Readonly<AppConfig>) {}
}
