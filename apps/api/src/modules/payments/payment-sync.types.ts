import type { Payment } from '../../generated/prisma/client.js';
import type {
  ProviderCreateParams,
  VerifiedProviderEvent,
} from '../../integrations/payment-provider.types.js';

export type SyncSource = 'confirmation_session' | 'sync' | 'webhook';
export type LeaseClaim = {
  payment: Payment;
  token: string;
  create: boolean;
  params: ProviderCreateParams | null;
  source: SyncSource;
  event?: VerifiedProviderEvent;
};
