import { Module, type DynamicModule } from '@nestjs/common';
import { ConfigModule } from '../../shared/config/config.module.js';
import { DatabaseModule } from '../../shared/database/database.module.js';
import { PaymentProviderModule } from '../../integrations/payment-provider.module.js';
import { PAYMENT_OPERATION_HOOKS } from '../../integrations/payment-operation-hooks.js';
import { PaymentsModule } from '../payments/payments.module.js';
import { SimulationController } from './simulation.controller.js';
import { SimulationService } from './services/simulation.service.js';
import { SimulationGuard } from './simulation.guard.js';
import { SimulationFaultRegistry } from './services/simulation-fault.registry.js';

@Module({})
export class SimulationModule {
  static register(env = process.env): DynamicModule {
    if (
      !['development', 'test'].includes(env.NODE_ENV ?? 'development') ||
      env.SIMULATION_ENABLED !== 'true'
    )
      return { module: SimulationModule };
    return {
      module: SimulationModule,
      global: true,
      imports: [
        ConfigModule,
        DatabaseModule,
        PaymentProviderModule,
        PaymentsModule,
      ],
      controllers: [SimulationController],
      providers: [
        SimulationService,
        SimulationGuard,
        SimulationFaultRegistry,
        {
          provide: PAYMENT_OPERATION_HOOKS,
          useExisting: SimulationFaultRegistry,
        },
      ],
      exports: [PAYMENT_OPERATION_HOOKS],
    };
  }
}
