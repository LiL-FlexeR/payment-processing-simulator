import type { PaymentStatus } from '../../generated/prisma/client.js';

export type ValidatedPaymentObservation = Readonly<{
  phase:
    | 'AWAITING_PAYMENT'
    | 'ACTION_REQUIRED'
    | 'PROCESSING'
    | 'DECLINED'
    | 'SUCCEEDED'
    | 'CANCELED'
    | 'UNSUPPORTED';
  source: 'confirmation_session' | 'webhook' | 'sync' | 'test';
}>;

const transitions: Readonly<Record<PaymentStatus, readonly PaymentStatus[]>> = {
  CREATED: ['PENDING', 'FAILED', 'SUCCEEDED', 'CANCELED'],
  PENDING: ['FAILED', 'SUCCEEDED', 'CANCELED'],
  FAILED: ['PENDING', 'SUCCEEDED', 'CANCELED'],
  SUCCEEDED: [],
  CANCELED: [],
};

export class InvalidPaymentTransition extends Error {
  constructor() {
    super('The validated observation contradicts the payment lifecycle.');
  }
}

export function transitionPaymentStatus(
  current: PaymentStatus,
  target: PaymentStatus,
): { status: PaymentStatus; changed: boolean } {
  if (current === target) return { status: current, changed: false };
  if (!transitions[current].includes(target))
    throw new InvalidPaymentTransition();
  return { status: target, changed: true };
}

export function projectObservation(
  current: PaymentStatus,
  observation: ValidatedPaymentObservation,
) {
  const targets = {
    AWAITING_PAYMENT: 'PENDING',
    ACTION_REQUIRED: 'PENDING',
    PROCESSING: 'PENDING',
    DECLINED: 'FAILED',
    SUCCEEDED: 'SUCCEEDED',
    CANCELED: 'CANCELED',
  } as const;
  if (observation.phase === 'UNSUPPORTED') throw new InvalidPaymentTransition();
  return transitionPaymentStatus(current, targets[observation.phase]);
}
