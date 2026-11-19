import { Module } from '@nestjs/common';
import { ConfigModule } from '../shared/config/config.module.js';
import { ConfigService } from '../shared/config/config.service.js';
import { PAYMENT_PROVIDER } from './payment-provider.token.js';
import { StripeModule } from './stripe/stripe.module.js';
import { StripePaymentProvider } from './stripe/stripe-payment.provider.js';

@Module({
  imports: [ConfigModule, StripeModule],
  providers: [
    {
      provide: PAYMENT_PROVIDER,
      inject: [ConfigService, StripePaymentProvider],
      useFactory: async (
        config: ConfigService,
        stripe: StripePaymentProvider,
      ) => {
        if (config.values.paymentProvider === 'stripe') {
          await stripe.initialize();
          return stripe;
        }
        // The fake module is neither loaded nor registered in production.
        const { FakePaymentProvider } =
          await import('./fake/fake-payment.provider.js');
        return new FakePaymentProvider(config.values);
      },
    },
  ],
  exports: [PAYMENT_PROVIDER],
})
export class PaymentProviderModule {}
