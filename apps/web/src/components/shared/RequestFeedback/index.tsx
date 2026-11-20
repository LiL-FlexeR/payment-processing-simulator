import { AlertCircle } from 'lucide-react';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { RequestError } from '@/api/client';
export function RequestFeedback({ error }: { error: unknown }) {
  if (!error) return null;
  return (
    <Alert>
      <AlertCircle aria-hidden="true" />
      <AlertTitle>Request needs attention</AlertTitle>
      <AlertDescription>
        {error instanceof RequestError ? (
          <>
            {error.message} Code: {error.code}.
            {error.retryAfter
              ? ` Retry after ${error.retryAfter} seconds.`
              : ''}
          </>
        ) : (
          'The request could not complete. Refresh and retry the same operation.'
        )}
      </AlertDescription>
    </Alert>
  );
}
