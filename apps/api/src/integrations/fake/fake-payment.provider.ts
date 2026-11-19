import { isDeepStrictEqual } from 'node:util';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import type { PaymentProvider } from '../payment-provider.interface.js';
import {
  InvalidProviderWebhook,
  ProviderFailure,
  type ProviderCreateParams,
  type ProviderObservation,
} from '../payment-provider.types.js';
import { snapshotEnvelope } from '../snapshot-envelope.js';
import type { AppConfig } from '../../shared/config/config.service.js';

export class FakePaymentProvider implements PaymentProvider {
  readonly name = 'fake' as const;
  readonly accountId = 'acct_fake';
  readonly publishableKey = 'pk_fake_synthetic';
  readonly intents = new Map<string, ProviderObservation>();
  readonly operations = new Map<string, { params: string; id: string }>();
  readonly fixtures = new Map<string, Buffer>();
  createCalls = 0;
  retrieveCalls = 0;
  loseNextCreateResponse = false;
  nextFailure: ProviderFailure | null = null;
  beforeRetrieve: (() => Promise<void>) | null = null;
  get apiVersion() {
    return this.config.stripeApiVersion;
  }
  constructor(private readonly config: Readonly<AppConfig>) {
    if (
      config.nodeEnv === 'production' ||
      !config.simulationEnabled ||
      config.paymentProvider !== 'fake' ||
      !new URL(config.databaseUrl).pathname.match(/_(test|fake)$/)
    )
      throw new Error(
        'Fake provider requires an explicitly enabled isolated development/test environment.',
      );
  }
  private fail() {
    const failure = this.nextFailure;
    this.nextFailure = null;
    if (failure) throw failure;
  }
  async createIntent(params: ProviderCreateParams, key: string) {
    this.createCalls++;
    this.fail();
    const existing = this.operations.get(key);
    if (existing && !isDeepStrictEqual(JSON.parse(existing.params), params))
      throw new ProviderFailure('blocked', 'PROVIDER_CONFIGURATION_ERROR');
    if (!existing) {
      const id = `pi_fake_${randomUUID().replaceAll('-', '')}`;
      this.intents.set(id, {
        id,
        accountId: this.accountId,
        amount: params.amount,
        currency: params.currency,
        metadata: { ...params.metadata },
        livemode: false,
        phase: 'AWAITING_PAYMENT',
        providerStatus: 'requires_payment_method',
        clientSecret: `${id}_secret_synthetic`,
        requestId: 'req_fakeCreate',
        paymentErrorCode: null,
        automaticCardWorkflow: true,
      });
      this.operations.set(key, { params: JSON.stringify(params), id });
    }
    if (this.loseNextCreateResponse) {
      this.loseNextCreateResponse = false;
      throw new ProviderFailure('transient', 'PROVIDER_UNAVAILABLE');
    }
    return structuredClone(this.intents.get(this.operations.get(key)!.id)!);
  }
  async retrieveIntent(id: string) {
    this.retrieveCalls++;
    this.fail();
    const observation = structuredClone(this.intents.get(id));
    if (this.beforeRetrieve) await this.beforeRetrieve();
    if (!observation)
      throw new ProviderFailure('review', 'PROVIDER_OBJECT_MISSING');
    return observation;
  }
  // Fixed synthetic scenarios only. Local financial state is never written here.
  confirm(id: string, scenario: 'success' | 'decline') {
    const intent = this.intents.get(id);
    if (
      !intent ||
      intent.phase === 'CANCELED' ||
      (intent.phase === 'SUCCEEDED' && scenario === 'decline')
    )
      throw new Error('Fake intent is not confirmable.');
    intent.phase = scenario === 'success' ? 'SUCCEEDED' : 'DECLINED';
    intent.providerStatus =
      scenario === 'success' ? 'succeeded' : 'requires_payment_method';
    intent.paymentErrorCode =
      scenario === 'decline' ? 'PAYMENT_DECLINED' : null;
    return this.event(
      id,
      scenario === 'success'
        ? 'payment_intent.succeeded'
        : 'payment_intent.payment_failed',
    );
  }
  event(id: string, type = 'payment_intent.created') {
    const intent = this.intents.get(id)!;
    const eventId = `evt_fake_${randomUUID().replaceAll('-', '')}`;
    const raw = Buffer.from(
      JSON.stringify({
        id: eventId,
        object: 'event',
        pending_webhooks: 1,
        request: {
          id: intent.requestId,
          idempotency_key: intent.metadata.operation_key,
        },
        api_version: this.apiVersion,
        created: Math.floor(Date.now() / 1000),
        livemode: false,
        type,
        data: {
          object: {
            id,
            object: 'payment_intent',
            livemode: false,
            metadata: intent.metadata,
            status: intent.providerStatus,
            amount: intent.amount,
            currency: intent.currency,
            amount_capturable: 0,
            amount_received: intent.phase === 'SUCCEEDED' ? intent.amount : 0,
            created: Math.floor(Date.now() / 1000),
            confirmation_method: 'automatic',
            capture_method: 'automatic',
            allowed_payment_method_types: ['card'],
            payment_method_types: ['card'],
            client_secret: intent.clientSecret,
            last_payment_error: intent.paymentErrorCode
              ? {
                  type: 'card_error',
                  code: 'card_declined',
                  decline_code: 'generic_decline',
                  message: 'Synthetic test decline.',
                }
              : null,
            automatic_payment_methods: null,
            application: null,
            application_fee_amount: null,
            customer: null,
            description: null,
            latest_charge: null,
            next_action: null,
            on_behalf_of: null,
            payment_method: null,
            payment_method_options: {
              card: { request_three_d_secure: 'automatic' },
            },
            processing: null,
            receipt_email: null,
            review: null,
            setup_future_usage: null,
            shipping: null,
            statement_descriptor: null,
            statement_descriptor_suffix: null,
            transfer_data: null,
            transfer_group: null,
            canceled_at: null,
            cancellation_reason: null,
          },
        },
      }),
    );
    this.fixtures.set(eventId, raw);
    return { id: eventId, raw, signature: this.sign(raw) };
  }
  sign(raw: Buffer, timestamp = Math.floor(Date.now() / 1000)) {
    const digest = createHmac('sha256', this.config.testWebhookSecret)
      .update(`${timestamp}.`)
      .update(raw)
      .digest('hex');
    return `t=${timestamp},v1=${digest}`;
  }
  verifyEvent(raw: Buffer, signature: string) {
    try {
      const parts = signature.split(',');
      const timestamp = parts.find((item) => item.startsWith('t='))?.slice(2);
      if (
        !timestamp ||
        !/^\d+$/.test(timestamp) ||
        Math.abs(Date.now() / 1000 - Number(timestamp)) > 300
      )
        throw new Error();
      const expected = Buffer.from(
        this.sign(raw, Number(timestamp)).split('v1=')[1]!,
        'hex',
      );
      const valid = parts
        .filter((item) => /^v1=[a-f0-9]{64}$/.test(item))
        .some((item) =>
          timingSafeEqual(expected, Buffer.from(item.slice(3), 'hex')),
        );
      if (!valid) throw new Error();
      return snapshotEnvelope(
        JSON.parse(raw.toString('utf8')),
        this.apiVersion,
      );
    } catch {
      throw new InvalidProviderWebhook();
    }
  }
  async retrieveTestEvent(id: string) {
    const fixture = this.fixtures.get(id);
    if (!fixture)
      throw new ProviderFailure('review', 'PROVIDER_OBJECT_MISSING');
    return Buffer.from(fixture);
  }
}
