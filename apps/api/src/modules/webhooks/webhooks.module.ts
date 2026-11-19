import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../shared/database/database.module.js';
import { ConfigModule } from '../../shared/config/config.module.js';
import { PaymentProviderModule } from '../../integrations/payment-provider.module.js';
import { PaymentsModule } from '../payments/payments.module.js';
import { WebhooksController } from './webhooks.controller.js';
import { WebhooksService } from './webhooks.service.js';

@Module({
  imports: [
    DatabaseModule,
    ConfigModule,
    PaymentProviderModule,
    PaymentsModule,
  ],
  controllers: [WebhooksController],
  providers: [WebhooksService],
})
export class WebhooksModule {}
