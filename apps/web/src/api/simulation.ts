import { client } from './client';
import type { CreatePayment } from './payments.types';
export type RaceReport = {
  runId: string;
  scenario: 'duplicate_request' | 'concurrent_requests';
  idempotencyKey: string;
  paymentIds: (string | null)[];
  responseStatuses: number[];
  uniquePaymentCount: number;
  creationEventCount: number;
};
export type ReplayReport = {
  eventId: string;
  deliveryStatuses: number[];
  storedDeliveryCount: number;
  processingStatus: string;
  financialTransitionCount: number;
};
export type ConfirmationReport = {
  paymentId: string;
  eventId: string;
  deliveryStatus: number;
};
export type FaultPoint = 'webhook_before_commit' | 'provider_response_timeout';
export async function requestRace(
  body: CreatePayment & { scenario: RaceReport['scenario'] },
) {
  return (await client.post<RaceReport>('/dev/simulations/request-race', body))
    .data;
}
export async function armFault(id: string, point: FaultPoint) {
  return (
    await client.post<{
      paymentId: string;
      point: FaultPoint;
      expiresAt: string;
      remaining: number;
    }>(`/dev/simulations/payments/${id}/fault`, { point })
  ).data;
}
export async function replayEvent(eventId: string) {
  return (
    await client.post<ReplayReport>(
      `/dev/simulations/webhooks/${eventId}/replay`,
      { deliveries: 2 },
    )
  ).data;
}
export async function fakeConfirm(id: string, scenario: 'success' | 'decline') {
  return (
    await client.post<ConfirmationReport>(
      `/dev/simulations/payments/${id}/confirm`,
      { scenario },
    )
  ).data;
}
