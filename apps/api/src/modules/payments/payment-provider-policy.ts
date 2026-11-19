import { randomInt } from 'node:crypto';
import type { Prisma, Payment } from '../../generated/prisma/client.js';
import type { PaymentProvider } from '../../integrations/payment-provider.interface.js';
import type {
  ProviderCreateParams,
  ProviderObservation,
} from '../../integrations/payment-provider.types.js';

export const CREATE_WINDOW_MS = 23 * 60 * 60 * 1000;
export function createAllowed(
  payment: Pick<Payment, 'firstProviderRequestAt' | 'createAttemptCount'>,
  now: Date,
) {
  return (
    payment.createAttemptCount < 6 &&
    (!payment.firstProviderRequestAt ||
      now.getTime() - payment.firstProviderRequestAt.getTime() <
        CREATE_WINDOW_MS)
  );
}
export function retryDelay(
  attempt: number,
  providerDelay = 0,
  jitter = randomInt(0, 251),
) {
  return Math.max(
    providerDelay,
    Math.min(30, 2 ** Math.max(0, attempt - 1)) * 1000 + jitter,
  );
}
export function frozenParams(
  payment: Payment,
  provider: PaymentProvider,
  instance: string,
): ProviderCreateParams {
  return {
    apiVersion: provider.apiVersion,
    accountId: provider.accountId,
    amount: payment.amount,
    currency: payment.currency.toLowerCase(),
    confirmationMethod: 'automatic',
    captureMethod: 'automatic',
    allowedPaymentMethodTypes: ['card'],
    metadata: {
      payment_id: payment.id,
      app_instance_id: instance,
      operation_key: payment.providerOperationKey,
    },
  };
}
export function validObservation(
  payment: Payment,
  observation: ProviderObservation,
  provider: PaymentProvider,
  instance: string,
) {
  return (
    /^pi_[A-Za-z0-9_]{1,200}$/.test(observation.id) &&
    observation.accountId === provider.accountId &&
    observation.livemode === false &&
    observation.amount === payment.amount &&
    observation.currency === payment.currency.toLowerCase() &&
    observation.automaticCardWorkflow &&
    observation.metadata.payment_id === payment.id &&
    observation.metadata.app_instance_id === instance &&
    observation.metadata.operation_key === payment.providerOperationKey &&
    (!payment.stripePaymentIntentId ||
      payment.stripePaymentIntentId === observation.id)
  );
}
export function history(
  value: Prisma.JsonValue | Prisma.InputJsonArray,
  now: Date,
  outcome: string,
  code?: string,
): Prisma.InputJsonArray {
  return [
    ...(Array.isArray(value) ? (value as Prisma.InputJsonArray) : []),
    { at: now.toISOString(), outcome, ...(code ? { code } : {}) },
  ];
}
