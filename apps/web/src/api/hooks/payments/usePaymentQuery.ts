import { useQuery } from '@tanstack/react-query';
import { getPayment } from '@/api/payments';
import type { PaymentDetails } from '@/api/payments.types';
export function pollingInterval(
  payment: PaymentDetails | undefined,
  startedAt: number,
  now = Date.now(),
) {
  return now - startedAt < 60000 &&
    (!payment || !['SUCCEEDED', 'CANCELED'].includes(payment.status))
    ? 2000
    : false;
}
export function usePaymentQuery(id: string, startedAt: number) {
  return useQuery({
    queryKey: ['payments', id, 'details'],
    queryFn: ({ signal }) => getPayment(id, signal),
    refetchInterval: (query) => pollingInterval(query.state.data, startedAt),
    refetchIntervalInBackground: false,
  });
}
