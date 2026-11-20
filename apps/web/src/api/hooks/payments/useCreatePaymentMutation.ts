import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createPayment } from '@/api/payments';
export function useCreatePaymentMutation() {
  const cache = useQueryClient();
  return useMutation({
    mutationFn: createPayment,
    onSuccess: async () => {
      await cache.invalidateQueries({ queryKey: ['payments'] });
    },
  });
}
