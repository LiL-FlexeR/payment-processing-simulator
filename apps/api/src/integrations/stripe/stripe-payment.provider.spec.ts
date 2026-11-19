import { jest } from '@jest/globals';
import Stripe from 'stripe';
import { Test } from '@nestjs/testing';
import {
  ConfigService,
  parseConfig,
  STRIPE_API_VERSION,
} from '../../shared/config/config.service.js';
import { ConfigModule } from '../../shared/config/config.module.js';
import { stripeEnv } from '../../../test/provider-env.js';
import { PaymentProviderModule } from '../payment-provider.module.js';
import { PAYMENT_PROVIDER } from '../payment-provider.token.js';
import { InvalidProviderWebhook } from '../payment-provider.types.js';
import type { ProviderCreateParams } from '../payment-provider.types.js';
import { normalizeStripeError } from './stripe-error.util.js';
import {
  STRIPE_CLIENT,
  StripePaymentProvider,
  normalizeIntent,
} from './stripe-payment.provider.js';

const config = new ConfigService(
  parseConfig({
    ...stripeEnv,
    NODE_ENV: 'test',
    DATABASE_URL: 'postgresql://user:synthetic@127.0.0.1:5433/simulator_test',
    WEB_ORIGIN: 'http://localhost:3000',
    APP_INSTANCE_ID: '2c1063a4-ce83-4e82-a152-5bacd5c255df',
  }),
);
const metadata = {
  payment_id: '9d576a31-e423-4422-9a4c-c1346ad6534e',
  app_instance_id: config.values.appInstanceId,
  operation_key: 'pps:pi:create:v1:9d576a31-e423-4422-9a4c-c1346ad6534e',
};
function intent(status: string, decline = false) {
  return {
    id: 'pi_synthetic',
    object: 'payment_intent',
    status,
    livemode: false,
    amount: 2500,
    currency: 'usd',
    metadata,
    confirmation_method: 'automatic',
    capture_method: 'automatic',
    payment_method_types: ['card'],
    client_secret: 'pi_synthetic_secret_test',
    last_payment_error: decline
      ? { type: 'card_error', code: 'card_declined', message: 'DO_NOT_STORE' }
      : null,
    lastResponse: { requestId: 'req_safe' },
    customer: null,
    on_behalf_of: null,
    transfer_data: null,
    setup_future_usage: null,
  } as unknown as Stripe.Response<Stripe.PaymentIntent>;
}
function envelope() {
  return {
    id: 'evt_synthetic',
    object: 'event',
    pending_webhooks: 1,
    request: null,
    api_version: STRIPE_API_VERSION,
    created: Math.floor(Date.now() / 1000),
    livemode: false,
    type: 'payment_intent.succeeded',
    data: { object: intent('succeeded') },
  };
}

describe('Stripe adapter at the pinned SDK/API boundary (no HTTP)', () => {
  const client = new Stripe('sk_test_synthetic', {
    apiVersion: STRIPE_API_VERSION,
    maxNetworkRetries: 0,
    timeout: 5000,
  });
  const provider = new StripePaymentProvider(client, config);
  afterEach(() => jest.restoreAllMocks());

  it.each([
    ['requires_payment_method', false, 'AWAITING_PAYMENT'],
    ['requires_payment_method', true, 'DECLINED'],
    ['requires_confirmation', false, 'AWAITING_PAYMENT'],
    ['requires_action', false, 'ACTION_REQUIRED'],
    ['processing', false, 'PROCESSING'],
    ['succeeded', false, 'SUCCEEDED'],
    ['canceled', false, 'CANCELED'],
    ['requires_capture', false, 'UNSUPPORTED'],
    ['future_status', false, 'UNSUPPORTED'],
  ])(
    'maps %s / decline=%s to %s without retaining raw errors',
    (status, decline, phase) => {
      const result = normalizeIntent(
        intent(status as string, decline as boolean),
        config.values.stripeAccountId,
        'req_safe',
      );
      expect(result.phase).toBe(phase);
      expect(result.paymentErrorCode).toBe(decline ? 'PAYMENT_DECLINED' : null);
      expect(JSON.stringify(result)).not.toContain('DO_NOT_STORE');
    },
  );

  it('restricts create to cards, automatic capture/confirmation and immutable metadata; passes one stable key', async () => {
    const create = jest
      .spyOn(client.paymentIntents, 'create')
      .mockResolvedValue(intent('requires_payment_method'));
    const retrieve = jest
      .spyOn(client.paymentIntents, 'retrieve')
      .mockResolvedValue(intent('processing'));
    const params: ProviderCreateParams = {
      apiVersion: STRIPE_API_VERSION,
      accountId: config.values.stripeAccountId,
      amount: 2500,
      currency: 'usd',
      confirmationMethod: 'automatic',
      captureMethod: 'automatic',
      allowedPaymentMethodTypes: ['card'],
      metadata,
    };
    const result = await provider.createIntent(params, metadata.operation_key);
    expect(create).toHaveBeenCalledWith(
      {
        amount: 2500,
        currency: 'usd',
        confirmation_method: 'automatic',
        capture_method: 'automatic',
        allowed_payment_method_types: ['card'],
        metadata,
      },
      { idempotencyKey: metadata.operation_key },
    );
    expect(create).toHaveBeenCalledTimes(1);
    expect(result.requestId).toBe('req_safe');
    expect((await provider.retrieveIntent('pi_synthetic')).phase).toBe(
      'PROCESSING',
    );
    expect(retrieve).toHaveBeenCalledWith('pi_synthetic');
    expect(retrieve).toHaveBeenCalledTimes(1);
  });

  it.each([429, 409, 500, 502, 503])(
    'classifies HTTP %s as unknown/transient with safe request IDs',
    (statusCode) => {
      const error = new Stripe.errors.StripeAPIError({
        message: 'sk_test_PRIVATE',
        statusCode,
        requestId: 'req_safe',
        headers: { 'retry-after': '12' },
      });
      expect(normalizeStripeError(error)).toMatchObject({
        kind: 'transient',
        code: 'PROVIDER_UNAVAILABLE',
        requestId: 'req_safe',
        retryAfterMs: 12000,
      });
      expect(JSON.stringify(normalizeStripeError(error))).not.toContain(
        'PRIVATE',
      );
    },
  );
  it.each([
    'StripeAuthenticationError',
    'StripePermissionError',
    'StripeInvalidRequestError',
  ] as const)('blocks %s without relabeling a financial decline', (type) => {
    const error = new Stripe.errors[type]({
      message: 'PRIVATE',
      statusCode: 400,
      requestId: 'unsafe_secret_value',
    });
    expect(normalizeStripeError(error)).toMatchObject({
      kind: 'blocked',
      code: 'PROVIDER_CONFIGURATION_ERROR',
      requestId: null,
    });
  });
  it('connection loss is transient, missing known object requires review and raw exceptions cannot leak', () => {
    expect(
      normalizeStripeError(
        new Stripe.errors.StripeConnectionError({ message: 'PRIVATE' }),
      ).kind,
    ).toBe('transient');
    expect(
      normalizeStripeError(
        new Stripe.errors.StripeInvalidRequestError({
          statusCode: 404,
          message: 'PRIVATE',
        }),
      ).kind,
    ).toBe('review');
    expect(normalizeStripeError(new Error('sk_test_PRIVATE'))).toMatchObject({
      kind: 'transient',
      message: 'PROVIDER_UNAVAILABLE',
    });
  });

  it('verifies SDK-generated signatures over exact bytes, mode/account/version and both timestamp directions', () => {
    const raw = Buffer.from(JSON.stringify(envelope()));
    const sign = (
      payload: Buffer,
      timestamp = Math.floor(Date.now() / 1000),
      secret = config.values.stripeWebhookSecret,
    ) =>
      client.webhooks.generateTestHeaderString({
        payload: payload.toString(),
        secret,
        timestamp,
      });
    expect(provider.verifyEvent(raw, sign(raw))).toMatchObject({
      id: 'evt_synthetic',
      providerObjectId: 'pi_synthetic',
      supported: true,
      metadataPaymentId: metadata.payment_id,
    });
    expect(() =>
      provider.verifyEvent(Buffer.concat([raw, Buffer.from(' ')]), sign(raw)),
    ).toThrow(InvalidProviderWebhook);
    expect(() =>
      provider.verifyEvent(raw, sign(raw, undefined, 'whsec_wrong')),
    ).toThrow(InvalidProviderWebhook);
    for (const offset of [-301, 301])
      expect(() =>
        provider.verifyEvent(
          raw,
          sign(raw, Math.floor(Date.now() / 1000) + offset),
        ),
      ).toThrow(InvalidProviderWebhook);
    for (const patch of [
      { livemode: true },
      { account: 'acct_foreign' },
      { context: 'acct_foreign' },
      { api_version: 'wrong' },
      { data: {} },
      { id: 'invalid' },
    ]) {
      const bytes = Buffer.from(JSON.stringify({ ...envelope(), ...patch }));
      expect(() => provider.verifyEvent(bytes, sign(bytes))).toThrow(
        InvalidProviderWebhook,
      );
    }
    const invalid = Buffer.from('{');
    expect(() => provider.verifyEvent(invalid, sign(invalid))).toThrow(
      InvalidProviderWebhook,
    );
  });

  it('validates the current account before exporting the port; rejects mismatch without logging account/key values', async () => {
    const retrieve = jest.spyOn(client.accounts, 'retrieve').mockResolvedValue({
      id: config.values.stripeAccountId,
    } as Stripe.Response<Stripe.Account>);
    const module = await Test.createTestingModule({
      imports: [ConfigModule, PaymentProviderModule],
    })
      .overrideProvider(ConfigService)
      .useValue(config)
      .overrideProvider(STRIPE_CLIENT)
      .useValue(client)
      .compile();
    expect(module.get(PAYMENT_PROVIDER)).toBeInstanceOf(StripePaymentProvider);
    expect(retrieve).toHaveBeenCalledWith(null);
    expect(retrieve).toHaveBeenCalledTimes(1);
    await module.close();
    retrieve.mockResolvedValue({
      id: 'acct_wrong',
    } as Stripe.Response<Stripe.Account>);
    await expect(
      Test.createTestingModule({
        imports: [ConfigModule, PaymentProviderModule],
      })
        .overrideProvider(ConfigService)
        .useValue(config)
        .overrideProvider(STRIPE_CLIENT)
        .useValue(client)
        .compile(),
    ).rejects.toThrow('Stripe startup account validation failed');
  });
});
