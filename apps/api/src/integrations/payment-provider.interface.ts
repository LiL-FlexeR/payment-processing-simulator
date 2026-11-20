import type {
  ProviderCreateParams,
  ProviderObservation,
  VerifiedProviderEvent,
} from './payment-provider.types.js';

export interface PaymentProvider {
  readonly name: 'stripe' | 'fake';
  readonly accountId: string;
  readonly apiVersion: string;
  readonly publishableKey: string;
  createIntent(
    params: ProviderCreateParams,
    key: string,
  ): Promise<ProviderObservation>;
  retrieveIntent(id: string): Promise<ProviderObservation>;
  verifyEvent(raw: Buffer, signature: string): VerifiedProviderEvent;
  // Used only for fixed, stored test-event replay in Stage 4.
  retrieveTestEvent(id: string): Promise<Buffer>;
  signTestEvent(raw: Buffer): string;
  // Absent on real providers; fixed fixture scenarios only.
  confirmTestIntent?(
    id: string,
    scenario: 'success' | 'decline',
  ): { id: string; raw: Buffer };
}
