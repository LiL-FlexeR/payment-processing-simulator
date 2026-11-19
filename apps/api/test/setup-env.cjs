// Explicit, isolated fake configuration; no Stripe credential or network dependency.
Object.assign(process.env, {
  PAYMENT_PROVIDER: 'fake',
  SIMULATION_ENABLED: 'true',
  SIMULATION_TOKEN: 'test_simulation_token_0123456789abcdef',
  TEST_WEBHOOK_SECRET: 'whsec_fake_0123456789abcdef0123456789abcdef',
  PAYMENT_RETURN_URL: 'http://localhost:3000/payments/return',
});

// Provider networking is forbidden in deterministic suites. Local HTTP/PostgreSQL
// remain available for Supertest and the real-database acceptance tests.
require('node:https').request = () => {
  throw new Error(
    'External provider HTTP is forbidden in deterministic tests.',
  );
};
