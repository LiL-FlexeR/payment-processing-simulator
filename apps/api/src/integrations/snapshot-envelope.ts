import {
  InvalidProviderWebhook,
  SNAPSHOT_EVENTS,
  type VerifiedProviderEvent,
} from './payment-provider.types.js';

const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const record = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

// Called only after cryptographic verification by the selected adapter.
export function snapshotEnvelope(
  input: unknown,
  apiVersion: string,
): VerifiedProviderEvent {
  const event = record(input);
  const object = record(record(event.data).object);
  const metadata = record(object.metadata);
  const supported = SNAPSHOT_EVENTS.some((type) => type === event.type);
  if (
    typeof event.id !== 'string' ||
    !/^evt_[A-Za-z0-9_]{1,200}$/.test(event.id) ||
    event.object !== 'event' ||
    typeof event.type !== 'string' ||
    !/^[a-z0-9_.]{1,200}$/.test(event.type) ||
    event.livemode !== false ||
    event.account !== undefined ||
    event.context !== undefined ||
    event.api_version !== apiVersion ||
    !Number.isSafeInteger(event.pending_webhooks) ||
    Number(event.pending_webhooks) < 0 ||
    (event.request !== null &&
      (!('id' in record(event.request)) ||
        !('idempotency_key' in record(event.request)))) ||
    typeof event.created !== 'number' ||
    !Number.isSafeInteger(event.created) ||
    event.created <= 0 ||
    event.created > 8640000000000 ||
    !Object.keys(object).length
  )
    throw new InvalidProviderWebhook();
  if (
    supported &&
    (object.object !== 'payment_intent' ||
      object.livemode !== false ||
      !Number.isSafeInteger(object.amount) ||
      typeof object.currency !== 'string' ||
      typeof object.status !== 'string' ||
      typeof object.id !== 'string' ||
      !/^pi_[A-Za-z0-9_]{1,200}$/.test(object.id) ||
      typeof metadata.payment_id !== 'string' ||
      !uuid.test(metadata.payment_id) ||
      typeof metadata.app_instance_id !== 'string' ||
      !uuid.test(metadata.app_instance_id) ||
      metadata.operation_key !== `pps:pi:create:v1:${metadata.payment_id}`)
  )
    throw new InvalidProviderWebhook();
  return {
    id: event.id,
    type: event.type,
    apiVersion,
    providerCreatedAt: new Date(event.created * 1000),
    livemode: false,
    supported,
    providerObjectId:
      object.object === 'payment_intent' &&
      typeof object.id === 'string' &&
      /^pi_[A-Za-z0-9_]{1,200}$/.test(object.id)
        ? object.id
        : null,
    metadataPaymentId:
      typeof metadata.payment_id === 'string' && uuid.test(metadata.payment_id)
        ? metadata.payment_id
        : null,
    metadataInstanceId:
      typeof metadata.app_instance_id === 'string' &&
      uuid.test(metadata.app_instance_id)
        ? metadata.app_instance_id
        : null,
    metadataOperationKey:
      typeof metadata.operation_key === 'string' &&
      /^pps:pi:create:v1:[a-f0-9-]{36}$/i.test(metadata.operation_key)
        ? metadata.operation_key
        : null,
  };
}
