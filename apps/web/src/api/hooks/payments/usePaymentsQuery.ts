import { useQuery } from '@tanstack/react-query';
import { listPayments } from '@/api/payments';
export function usePaymentsQuery(status: string, cursor?: string) {
  return useQuery({
    queryKey: ['payments', 'list', { status, cursor }],
    queryFn: ({ signal }) =>
      listPayments({ status: status || undefined, cursor, limit: 10 }, signal),
  });
}
