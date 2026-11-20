import { QueryClient } from '@tanstack/react-query';
export function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
        refetchOnMount: true,
        staleTime: 0,
        gcTime: 300000,
      },
      mutations: { retry: false, gcTime: 0 },
    },
  });
}
