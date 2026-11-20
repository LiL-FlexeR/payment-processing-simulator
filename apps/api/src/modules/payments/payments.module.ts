import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../shared/database/database.module.js';
import { PaymentsController } from './payments.controller.js';
import { PaymentsService } from './services/payments.service.js';
import { PaymentStatusService } from './services/payment-status.service.js';
import { PaymentProviderModule } from '../../integrations/payment-provider.module.js';
import { PaymentLeaseService } from './services/payment-lease.service.js';
import { PaymentSyncService } from './services/payment-sync.service.js';
import { ConfigModule } from '../../shared/config/config.module.js';

@Module({
  imports: [DatabaseModule, ConfigModule, PaymentProviderModule],
  controllers: [PaymentsController],
  providers: [
    PaymentsService,
    PaymentStatusService,
    PaymentLeaseService,
    PaymentSyncService,
  ],
  exports: [PaymentStatusService, PaymentSyncService, PaymentLeaseService],
})
export class PaymentsModule {}
