import { Module } from '@nestjs/common';
import Stripe from 'stripe';
import { ConfigModule } from '../../shared/config/config.module.js';
import { ConfigService } from '../../shared/config/config.service.js';
import {
  STRIPE_CLIENT,
  StripePaymentProvider,
} from './stripe-payment.provider.js';

@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: STRIPE_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        config.values.paymentProvider === 'stripe'
          ? new Stripe(config.values.stripeSecretKey, {
              apiVersion: config.values.stripeApiVersion,
              timeout: 5000,
              maxNetworkRetries: 0,
              telemetry: false,
            })
          : null,
    },
    StripePaymentProvider,
  ],
  exports: [StripePaymentProvider],
})
export class StripeModule {}
