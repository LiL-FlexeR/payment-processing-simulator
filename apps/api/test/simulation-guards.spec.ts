import { Test } from '@nestjs/testing';
import request from 'supertest';
import { ConfigService } from '../src/shared/config/config.service.js';
import { ConfigModule } from '../src/shared/config/config.module.js';
import { SimulationModule } from '../src/modules/simulation/simulation.module.js';
import { SimulationFaultRegistry } from '../src/modules/simulation/services/simulation-fault.registry.js';
import { configureHttp } from '../src/shared/http/configure-http.js';
import { jest } from '@jest/globals';

describe('simulation registration and ephemeral faults', () => {
  it.each([
    { NODE_ENV: 'production', SIMULATION_ENABLED: 'true' },
    { NODE_ENV: 'development', SIMULATION_ENABLED: 'false' },
  ])('unregisters every route for %j', async (env) => {
    const module = await Test.createTestingModule({
      imports: [ConfigModule, SimulationModule.register(env)],
    })
      .overrideProvider(ConfigService)
      .useValue({
        values: {
          nodeEnv: env.NODE_ENV,
          simulationEnabled: env.SIMULATION_ENABLED === 'true',
        },
      })
      .compile();
    const app = module.createNestApplication({
      bodyParser: false,
      logger: false,
    });
    configureHttp(app);
    await app.init();
    try {
      for (const path of [
        'request-race',
        'payments/id/fault',
        'payments/id/confirm',
        'webhooks/evt_test/replay',
      ])
        await request(app.getHttpServer())
          .post(`/api/v1/dev/simulations/${path}`)
          .set('Authorization', 'Bearer valid_even_in_production')
          .send({})
          .expect(404);
    } finally {
      await app.close();
    }
  });
  it('expires after 60 seconds, does not stack, and consumes only the scoped point once', () => {
    jest.useFakeTimers();
    try {
      const registry = new SimulationFaultRegistry({
        values: { nodeEnv: 'test', simulationEnabled: true },
      } as ConfigService);
      const a = registry.arm('payment-a', 'webhook_before_commit');
      expect(registry.arm('payment-a', 'webhook_before_commit')).toEqual(a);
      expect(() =>
        registry.arm('payment-a', 'provider_response_timeout'),
      ).toThrow();
      expect(registry.consume('payment-b', 'webhook_before_commit')).toBe(
        false,
      );
      expect(registry.consume('payment-a', 'provider_response_timeout')).toBe(
        false,
      );
      expect(registry.consume('payment-a', 'webhook_before_commit')).toBe(true);
      expect(registry.consume('payment-a', 'webhook_before_commit')).toBe(
        false,
      );
      registry.arm('payment-a', 'provider_response_timeout');
      jest.advanceTimersByTime(60000);
      expect(registry.consume('payment-a', 'provider_response_timeout')).toBe(
        false,
      );
    } finally {
      jest.useRealTimers();
    }
  });
});
