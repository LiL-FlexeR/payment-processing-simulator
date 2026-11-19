import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../shared/database/database.module.js';
import { PaymentsController } from './payments.controller.js';
import { PaymentsService } from './services/payments.service.js';
import { PaymentStatusService } from './services/payment-status.service.js';

@Module({
  imports: [DatabaseModule],
  controllers: [PaymentsController],
  providers: [PaymentsService, PaymentStatusService],
  exports: [PaymentStatusService],
})
export class PaymentsModule {}
