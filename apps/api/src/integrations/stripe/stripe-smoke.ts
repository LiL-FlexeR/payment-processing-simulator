import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { setTimeout } from 'node:timers/promises';
import Stripe from 'stripe';
import {
  ConfigService,
  parseConfig,
} from '../../shared/config/config.service.js';
import { DatabaseService } from '../../shared/database/database.service.js';

// Separate opt-in real-provider exercise. It creates test-mode objects and needs
// a running Stripe-mode API plus an authentic CLI/dashboard webhook forwarder.
async function smoke() {
  if (process.env.STRIPE_SMOKE_ENABLED !== 'true') {
    console.log(
      'SKIPPED: set STRIPE_SMOKE_ENABLED=true with a configured test API and authentic webhook forwarding.',
    );
    return;
  }
  const config = parseConfig(process.env);
  if (
    config.paymentProvider !== 'stripe' ||
    config.simulationEnabled ||
    config.nodeEnv === 'production'
  )
    throw new Error(
      'Use an isolated local Stripe test environment with simulations disabled.',
    );
  const client = new Stripe(config.stripeSecretKey, {
    apiVersion: config.stripeApiVersion,
    maxNetworkRetries: 0,
    timeout: 5000,
    telemetry: false,
  });
  if ((await client.accounts.retrieve(null)).id !== config.stripeAccountId)
    throw new Error('Stripe account mismatch.');
  const db = new DatabaseService(new ConfigService(config));
  const origin = `http://127.0.0.1:${config.apiPort}/api/v1`;
  async function api(path: string, body: object) {
    const response = await fetch(origin + path, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': randomUUID(),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok)
      throw new Error(
        'Local smoke API request failed; inspect safe application logs.',
      );
    return response.json() as Promise<Record<string, unknown>>;
  }
  try {
    for (const scenario of ['success', 'decline'] as const) {
      const payment = await api('/payments', { amount: 2500, currency: 'USD' });
      const id = payment.id as string;
      const session = await api(`/payments/${id}/confirmation-session`, {});
      if (session.provider !== 'stripe')
        throw new Error('Smoke API must use Stripe.');
      const stored = await db.payment.findUniqueOrThrow({ where: { id } });
      try {
        await client.paymentIntents.confirm(
          stored.stripePaymentIntentId!,
          {
            payment_method:
              scenario === 'success'
                ? 'pm_card_visa'
                : 'pm_card_chargeDeclined',
            return_url: config.paymentReturnUrl,
          },
          { idempotencyKey: `pps:smoke:confirm:v1:${id}` },
        );
        if (scenario === 'decline')
          throw new Error('Expected a Stripe test decline.');
      } catch (error) {
        if (
          scenario !== 'decline' ||
          !(error instanceof Stripe.errors.StripeCardError)
        )
          throw error;
      }
      const expected = scenario === 'success' ? 'SUCCEEDED' : 'FAILED';
      let eventId: string | null = null;
      // Wait only for authentic forwarded events; sync alone cannot pass this check.
      for (let n = 0; n < 32; n++) {
        const current = await db.payment.findUniqueOrThrow({ where: { id } });
        const receipt = await db.webhookEvent.findFirst({
          where: {
            paymentId: id,
            status: 'PROCESSED',
            type:
              scenario === 'success'
                ? 'payment_intent.succeeded'
                : 'payment_intent.payment_failed',
          },
        });
        if (current.status === expected && receipt) {
          eventId = receipt.id;
          break;
        }
        await setTimeout(250);
      }
      if (!eventId)
        throw new Error(
          'Authentic webhook smoke verification incomplete. Check the pinned snapshot version/listener secret and resend.',
        );
      const synced = await api(`/payments/${id}/sync`, {});
      if (synced.status !== expected)
        throw new Error('Unexpected smoke projection.');
      console.log(
        JSON.stringify({
          scenario,
          paymentId: id,
          providerObjectId: stored.stripePaymentIntentId,
          webhookEventId: eventId,
          status: expected,
        }),
      );
    }
  } finally {
    await db.$disconnect();
  }
}
void smoke().catch(() => {
  console.error(
    'Stripe smoke failed. Inspect safe application logs and test dashboard; credentials/provider payloads are not printed.',
  );
  process.exitCode = 1;
});
