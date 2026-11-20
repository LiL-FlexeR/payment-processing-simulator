import { useMutation, useQueryClient } from '@tanstack/react-query';
import { syncPayment } from '@/api/payments';
export function useSyncPaymentMutation(id: string) {
  const cache = useQueryClient();
  return useMutation({
    mutationFn: () => syncPayment(id),
    onSettled: async () => {
      await cache.invalidateQueries({ queryKey: ['payments'] });
    },
  });
}
