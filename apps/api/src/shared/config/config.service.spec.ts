import { fakeEnv, stripeEnv } from '../../../test/provider-env.js';
import { parseConfig } from './config.service.js';

const valid = {
  ...fakeEnv,
  NODE_ENV: 'test',
  DATABASE_URL:
    'postgresql://user:private-password@127.0.0.1:5433/simulator_test',
  WEB_ORIGIN: 'http://localhost:3000',
  APP_INSTANCE_ID: '2c1063a4-ce83-4e82-a152-5bacd5c255df',
};

describe('startup configuration', () => {
  it('has typed defaults without requiring Stripe', () => {
    expect(parseConfig(valid)).toMatchObject({
      nodeEnv: 'test',
      apiPort: 3001,
      webOrigin: valid.WEB_ORIGIN,
    });
  });

  it.each(['DATABASE_URL', 'WEB_ORIGIN', 'APP_INSTANCE_ID'])(
    'requires %s without echoing values',
    (key) => {
      expect(() => parseConfig({ ...valid, [key]: undefined })).toThrow(key);
    },
  );

  it.each([
    ['NODE_ENV', 'staging'],
    ['API_PORT', '0'],
    ['API_PORT', '65536'],
    ['API_PORT', '3e3'],
    ['API_PORT', '3001.5'],
    ['API_PORT', ''],
    ['DATABASE_URL', 'https://user:secret@db/database'],
    ['DATABASE_URL', 'postgresql://db/database'],
    ['APP_INSTANCE_ID', 'new-id'],
    ['WEB_ORIGIN', 'https://example.com'],
    ['WEB_ORIGIN', 'http://localhost:3000/path'],
    ['WEB_ORIGIN', 'http://localhost:3000/'],
    ['PAYMENT_PROVIDER', 'stripe'],
    ['PAYMENT_PROVIDER', 'other'],
    ['SIMULATION_ENABLED', 'false'],
  ])('rejects invalid %s safely', (key, value) => {
    try {
      parseConfig({ ...valid, [key]: value });
      throw new Error('Expected validation to fail');
    } catch (error) {
      expect((error as Error).message).toContain('Invalid configuration:');
      expect((error as Error).message).not.toContain('private-password');
      expect((error as Error).message).not.toContain('postgresql://');
      expect((error as Error).message).not.toContain('https://');
    }
  });
});

// Every failure is named without printing user-supplied credentials.
describe('Stage 3 mode-specific safety', () => {
  it.each([
    { NODE_ENV: 'production' },
    { SIMULATION_ENABLED: 'false' },
    { SIMULATION_TOKEN: 'short' },
    { TEST_WEBHOOK_SECRET: 'whsec_stripe_not_fake' },
    {
      DATABASE_URL:
        'postgresql://user:private-password@127.0.0.1:5432/simulator_dev',
    },
    { PAYMENT_RETURN_URL: 'https://foreign.test/payments/return' },
    {
      PAYMENT_RETURN_URL:
        'http://localhost:3000/payments/return?secret=private-password',
    },
  ])('rejects unsafe fake/return-url settings %j', (patch) => {
    expect(() => parseConfig({ ...valid, ...patch })).toThrow(
      'Invalid configuration',
    );
  });
});

describe('Stripe startup key/account/version requirements', () => {
  const stripe = { ...valid, ...stripeEnv };
  it('accepts a fully configured test-mode integration without enabling simulations', () => {
    expect(parseConfig(stripe)).toMatchObject({
      paymentProvider: 'stripe',
      simulationEnabled: false,
      stripeApiVersion: '2026-11-18.endive',
    });
  });
  it.each([
    ['STRIPE_SECRET_KEY', 'sk_live_private'],
    ['STRIPE_SECRET_KEY', 'rk_test_private'],
    ['NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY', 'pk_live_private'],
    ['STRIPE_WEBHOOK_SECRET', ''],
    ['STRIPE_ACCOUNT_ID', ''],
    ['STRIPE_API_VERSION', 'latest'],
    ['STRIPE_API_VERSION', '2026-10-28.endive'],
  ])('rejects invalid %s without exposing values', (key, value) => {
    expect(() => parseConfig({ ...stripe, [key]: value })).toThrow(
      'Invalid configuration',
    );
    try {
      parseConfig({ ...stripe, [key]: value });
    } catch (error) {
      expect((error as Error).message).not.toContain('private');
    }
  });
});
