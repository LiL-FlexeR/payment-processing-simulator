import { useRef, useState, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { confirmationSession } from '@/api/payments';
import type { ConfirmationSession } from '@/api/payments.types';
// Secrets live only in this mounted component. No QueryCache/MutationCache,
// browser storage, URL, logger, or persistent global is involved.
export function useConfirmationSession(id: string) {
  const [session, setSession] = useState<ConfirmationSession | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const cache = useQueryClient();
  const active = useRef<AbortController | null>(null);
  useEffect(() => () => active.current?.abort(), []);
  async function open() {
    if (active.current) return;
    const controller = new AbortController();
    active.current = controller;
    setBusy(true);
    setError(null);
    try {
      const result = await confirmationSession(id, controller.signal);
      if (!controller.signal.aborted) setSession(result);
    } catch (error) {
      if (!controller.signal.aborted) setError(error);
    } finally {
      if (!controller.signal.aborted) {
        setBusy(false);
        active.current = null;
        await cache.invalidateQueries({ queryKey: ['payments'] });
      }
    }
  }
  return { session, busy, error, open };
}
