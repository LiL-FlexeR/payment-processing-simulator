import { client } from './client';
import type {
  ConfirmationSession,
  CreatePayment,
  Creation,
  Page,
  Payment,
  PaymentDetails,
  PaymentEvent,
} from './payments.types';
export async function listPayments(
  params: { status?: string; cursor?: string; limit?: number },
  signal?: AbortSignal,
) {
  return (await client.get<Page<Payment>>('/payments', { params, signal }))
    .data;
}
export async function getPayment(id: string, signal?: AbortSignal) {
  return (await client.get<PaymentDetails>(`/payments/${id}`, { signal })).data;
}
export async function getPaymentEvents(
  id: string,
  cursor?: string,
  signal?: AbortSignal,
) {
  return (
    await client.get<Page<PaymentEvent>>(`/payments/${id}/events`, {
      params: { cursor, limit: 20 },
      signal,
    })
  ).data;
}
export async function createPayment(input: {
  key: string;
  body: CreatePayment;
}) {
  return (
    await client.post<Creation>('/payments', input.body, {
      headers: { 'Idempotency-Key': input.key },
    })
  ).data;
}
export async function syncPayment(id: string) {
  return (await client.post<PaymentDetails>(`/payments/${id}/sync`, {})).data;
}
// Invoke directly from local state: never wrap this request in a query/mutation.
export async function confirmationSession(id: string, signal?: AbortSignal) {
  return (
    await client.post<ConfirmationSession>(
      `/payments/${id}/confirmation-session`,
      {},
      { signal },
    )
  ).data;
}
