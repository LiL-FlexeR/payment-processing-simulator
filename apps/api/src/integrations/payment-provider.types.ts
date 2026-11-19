export type ProviderPhase =
  | 'AWAITING_PAYMENT'
  | 'ACTION_REQUIRED'
  | 'PROCESSING'
  | 'DECLINED'
  | 'SUCCEEDED'
  | 'CANCELED'
  | 'UNSUPPORTED';

// Durable, non-sensitive operation description. The adapter owns wire parameters.
export type ProviderCreateParams = {
  apiVersion: string;
  accountId: string;
  amount: number;
  currency: string;
  confirmationMethod: 'automatic';
  captureMethod: 'automatic';
  allowedPaymentMethodTypes: ['card'];
  metadata: {
    payment_id: string;
    app_instance_id: string;
    operation_key: string;
  };
};

export type ProviderObservation = {
  id: string;
  accountId: string;
  livemode: boolean;
  amount: number;
  currency: string;
  metadata: Record<string, string>;
  phase: ProviderPhase;
  providerStatus: string;
  clientSecret: string | null;
  requestId: string | null;
  paymentErrorCode: 'PAYMENT_DECLINED' | null;
  automaticCardWorkflow: boolean;
};

export const SNAPSHOT_EVENTS = [
  'payment_intent.created',
  'payment_intent.processing',
  'payment_intent.requires_action',
  'payment_intent.payment_failed',
  'payment_intent.succeeded',
  'payment_intent.canceled',
] as const;

export type VerifiedProviderEvent = {
  id: string;
  type: string;
  apiVersion: string;
  providerCreatedAt: Date;
  livemode: false;
  providerObjectId: string | null;
  metadataPaymentId: string | null;
  metadataInstanceId: string | null;
  metadataOperationKey: string | null;
  supported: boolean;
};

export class ProviderFailure extends Error {
  constructor(
    readonly kind: 'transient' | 'blocked' | 'review',
    readonly code: string,
    readonly requestId: string | null = null,
    readonly retryAfterMs = 0,
  ) {
    super(code);
  }
}

export class InvalidProviderWebhook extends Error {
  constructor() {
    super('Invalid provider webhook.');
  }
}
