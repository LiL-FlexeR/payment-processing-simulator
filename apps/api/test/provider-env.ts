// Synthetic credentials only. These never permit network calls in deterministic tests.
export const fakeEnv = {
  PAYMENT_PROVIDER: 'fake',
  SIMULATION_ENABLED: 'true',
  SIMULATION_TOKEN: 'test_simulation_token_0123456789abcdef',
  TEST_WEBHOOK_SECRET: 'whsec_fake_0123456789abcdef0123456789abcdef',
  PAYMENT_RETURN_URL: 'http://localhost:3000/payments/return',
};
export const stripeEnv = {
  PAYMENT_PROVIDER: 'stripe',
  SIMULATION_ENABLED: 'false',
  STRIPE_SECRET_KEY: 'sk_test_synthetic',
  NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: 'pk_test_synthetic',
  STRIPE_WEBHOOK_SECRET: 'whsec_synthetic',
  STRIPE_ACCOUNT_ID: 'acct_synthetic',
  STRIPE_API_VERSION: '2026-11-18.endive',
  PAYMENT_RETURN_URL: 'http://localhost:3000/payments/return',
};
