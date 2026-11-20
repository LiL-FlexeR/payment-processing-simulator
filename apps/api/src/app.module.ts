import { Module } from '@nestjs/common';
import { ConfigModule } from './shared/config/config.module.js';
import { HealthModule } from './modules/health/health.module.js';
import { PaymentsModule } from './modules/payments/payments.module.js';
import { WebhooksModule } from './modules/webhooks/webhooks.module.js';
import { SimulationModule } from './modules/simulation/simulation.module.js';

@Module({
  imports: [
    ConfigModule,
    HealthModule,
    PaymentsModule,
    WebhooksModule,
    SimulationModule.register(),
  ],
})
export class AppModule {}
