import Stripe from 'stripe';
import { ProviderFailure } from '../payment-provider.types.js';

export function safeRequestId(value: unknown): string | null {
  return typeof value === 'string' && /^req_[A-Za-z0-9]{1,200}$/.test(value)
    ? value
    : null;
}

export function normalizeStripeError(error: unknown): ProviderFailure {
  if (!(error instanceof Stripe.errors.StripeError))
    return new ProviderFailure('transient', 'PROVIDER_UNAVAILABLE');
  const id = safeRequestId(error.requestId);
  const status = error.statusCode ?? 0;
  const delay = error.headers?.['retry-after'];
  const seconds =
    typeof delay === 'string' && /^\d+$/.test(delay) ? Number(delay) : null;
  const dateDelay =
    typeof delay === 'string' ? Date.parse(delay) - Date.now() : NaN;
  const retryAfter =
    seconds !== null && Number.isSafeInteger(seconds)
      ? Math.min(seconds * 1000, 8640000000000000 - Date.now())
      : Number.isFinite(dateDelay) && dateDelay > 0
        ? dateDelay
        : 0;
  if (
    status === 429 ||
    status === 409 ||
    status >= 500 ||
    error.type === 'StripeConnectionError' ||
    error.type === 'StripeAPIError'
  )
    return new ProviderFailure(
      'transient',
      'PROVIDER_UNAVAILABLE',
      id,
      retryAfter,
    );
  if (status === 404)
    return new ProviderFailure('review', 'PROVIDER_OBJECT_MISSING', id);
  return new ProviderFailure('blocked', 'PROVIDER_CONFIGURATION_ERROR', id);
}
