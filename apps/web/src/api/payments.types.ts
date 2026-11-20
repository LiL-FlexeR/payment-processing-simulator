export const paymentStatuses = [
  'CREATED',
  'PENDING',
  'FAILED',
  'SUCCEEDED',
  'CANCELED',
] as const;
export type PaymentStatus = (typeof paymentStatuses)[number];
export type CreatePayment = { amount: number; currency: 'USD' | 'EUR' };
export type Creation = CreatePayment & {
  id: string;
  status: 'CREATED';
  createdAt: string;
};
export type Payment = Omit<Creation, 'status'> & {
  status: PaymentStatus;
  updatedAt: string;
  statusVersion: number;
  provisioningStatus:
    'NOT_STARTED' | 'READY' | 'RETRYABLE' | 'BLOCKED' | 'REVIEW_REQUIRED';
};
export type PaymentDetails = Payment & {
  stripePaymentIntentId: string | null;
  providerStatus: string | null;
  lastSyncedAt: string | null;
  nextProviderRetryAt: string | null;
  lastProviderErrorCode: string | null;
};
export type PaymentEvent = {
  id: string;
  paymentId: string;
  type: string;
  fromStatus: PaymentStatus | null;
  toStatus: PaymentStatus | null;
  statusVersion: number | null;
  webhookEventId: string | null;
  details: Record<string, string>;
  createdAt: string;
};
export type Page<T> = { items: T[]; nextCursor: string | null };
export type ConfirmationSession = {
  paymentId: string;
  provider: 'stripe' | 'fake';
  clientSecret: string;
  publishableKey: string;
  providerStatus: string;
};
