import { parseConfig } from './config.service.js';

const valid = {
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
    ['PAYMENT_PROVIDER', 'fake'],
    ['SIMULATION_ENABLED', 'true'],
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
