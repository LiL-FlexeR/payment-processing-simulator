import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  armFault,
  fakeConfirm,
  replayEvent,
  requestRace,
  type FaultPoint,
} from '@/api/simulation';
export function useRaceMutation() {
  const cache = useQueryClient();
  return useMutation({
    mutationFn: requestRace,
    onSettled: () => cache.invalidateQueries({ queryKey: ['payments'] }),
  });
}
export function useFaultMutation(id: string) {
  return useMutation({
    mutationFn: (point: FaultPoint) => armFault(id, point),
  });
}
export function useReplayMutation() {
  const cache = useQueryClient();
  return useMutation({
    mutationFn: replayEvent,
    onSettled: () => cache.invalidateQueries({ queryKey: ['payments'] }),
  });
}
export function useFakeConfirmMutation(id: string) {
  const cache = useQueryClient();
  return useMutation({
    mutationFn: (scenario: 'success' | 'decline') => fakeConfirm(id, scenario),
    onSettled: () => cache.invalidateQueries({ queryKey: ['payments'] }),
  });
}
