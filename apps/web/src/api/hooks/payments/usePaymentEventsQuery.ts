import { useInfiniteQuery } from '@tanstack/react-query';
import { getPaymentEvents } from '@/api/payments';
export function usePaymentEventsQuery(id: string, version?: string) {
  return useInfiniteQuery({
    queryKey: ['payments', id, 'events', version],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) => getPaymentEvents(id, pageParam, signal),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
}
