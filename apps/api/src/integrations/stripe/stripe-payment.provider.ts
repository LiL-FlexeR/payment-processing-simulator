import { Inject, Injectable } from '@nestjs/common';
import Stripe from 'stripe';
import { ConfigService } from '../../shared/config/config.service.js';
import type { PaymentProvider } from '../payment-provider.interface.js';
import {
  InvalidProviderWebhook,
  ProviderFailure,
  type ProviderCreateParams,
  type ProviderObservation,
  type ProviderPhase,
} from '../payment-provider.types.js';
import { snapshotEnvelope } from '../snapshot-envelope.js';
import { normalizeStripeError, safeRequestId } from './stripe-error.util.js';

export const STRIPE_CLIENT = Symbol('STRIPE_CLIENT');

export function normalizeIntent(
  intent: Stripe.PaymentIntent,
  accountId: string,
  requestId: unknown = null,
): ProviderObservation {
  const phases: Record<string, ProviderPhase> = {
    requires_payment_method: intent.last_payment_error
      ? 'DECLINED'
      : 'AWAITING_PAYMENT',
    requires_confirmation: 'AWAITING_PAYMENT',
    requires_action: 'ACTION_REQUIRED',
    processing: 'PROCESSING',
    succeeded: 'SUCCEEDED',
    canceled: 'CANCELED',
  };
  return {
    id: intent.id,
    accountId,
    livemode: intent.livemode,
    amount: intent.amount,
    currency: intent.currency,
    metadata: intent.metadata,
    phase: phases[intent.status] ?? 'UNSUPPORTED',
    providerStatus: intent.status,
    clientSecret: intent.client_secret,
    requestId: safeRequestId(requestId),
    paymentErrorCode: intent.last_payment_error ? 'PAYMENT_DECLINED' : null,
    automaticCardWorkflow:
      intent.confirmation_method === 'automatic' &&
      intent.capture_method === 'automatic' &&
      intent.payment_method_types.length === 1 &&
      intent.payment_method_types[0] === 'card' &&
      !intent.customer &&
      !intent.on_behalf_of &&
      !intent.transfer_data &&
      !intent.setup_future_usage,
  };
}

@Injectable()
export class StripePaymentProvider implements PaymentProvider {
  readonly name = 'stripe' as const;
  get accountId() {
    return this.config.values.stripeAccountId;
  }
  get apiVersion() {
    return this.config.values.stripeApiVersion;
  }
  get publishableKey() {
    return this.config.values.stripePublishableKey;
  }
  constructor(
    @Inject(STRIPE_CLIENT) private readonly client: Stripe | null,
    private readonly config: ConfigService,
  ) {}

  async initialize() {
    try {
      const account = await this.client!.accounts.retrieve(null);
      if (account.id !== this.accountId) throw new Error();
    } catch {
      throw new Error(
        'Stripe startup account validation failed. Check test-mode configuration; values are not logged.',
      );
    }
  }
  async createIntent(params: ProviderCreateParams, key: string) {
    try {
      if (
        params.apiVersion !== this.apiVersion ||
        params.accountId !== this.accountId
      )
        throw new ProviderFailure('blocked', 'PROVIDER_CONFIGURATION_ERROR');
      const intent = await this.client!.paymentIntents.create(
        {
          amount: params.amount,
          currency: params.currency,
          confirmation_method: params.confirmationMethod,
          capture_method: params.captureMethod,
          allowed_payment_method_types: params.allowedPaymentMethodTypes,
          metadata: params.metadata,
        },
        { idempotencyKey: key },
      );
      return normalizeIntent(
        intent,
        this.accountId,
        intent.lastResponse.requestId,
      );
    } catch (error) {
      if (error instanceof ProviderFailure) throw error;
      throw normalizeStripeError(error);
    }
  }
  async retrieveIntent(id: string) {
    try {
      const intent = await this.client!.paymentIntents.retrieve(id);
      return normalizeIntent(
        intent,
        this.accountId,
        intent.lastResponse.requestId,
      );
    } catch (error) {
      if (error instanceof ProviderFailure) throw error;
      throw normalizeStripeError(error);
    }
  }
  verifyEvent(raw: Buffer, signature: string) {
    try {
      const timestamp = signature
        .split(',')
        .find((item) => item.startsWith('t='))
        ?.slice(2);
      if (
        !timestamp ||
        !/^\d+$/.test(timestamp) ||
        Math.abs(Date.now() / 1000 - Number(timestamp)) > 300
      )
        throw new Error();
      const event = this.client!.webhooks.constructEvent(
        raw,
        signature,
        this.config.values.stripeWebhookSecret,
        300,
      );
      return snapshotEnvelope(event, this.apiVersion);
    } catch {
      throw new InvalidProviderWebhook();
    }
  }
  async retrieveTestEvent(id: string) {
    try {
      const event = await this.client!.events.retrieve(id);
      snapshotEnvelope(event, this.apiVersion);
      return Buffer.from(JSON.stringify(event));
    } catch (error) {
      if (error instanceof InvalidProviderWebhook) throw error;
      throw normalizeStripeError(error);
    }
  }
  signTestEvent(raw: Buffer) {
    return this.client!.webhooks.generateTestHeaderString({
      payload: raw.toString('utf8'),
      secret: this.config.values.stripeWebhookSecret,
    });
  }
}
