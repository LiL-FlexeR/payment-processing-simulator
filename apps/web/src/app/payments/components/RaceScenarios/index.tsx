'use client';
import Link from 'next/link';
import { useRaceMutation } from '@/api/hooks/simulation/useScenarioMutations';
import { Button } from '@/components/ui/button';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { RequestFeedback } from '@/components/shared/RequestFeedback';
export function RaceScenarios() {
  const run = useRaceMutation();
  const report = run.data;
  const passed =
    report &&
    report.uniquePaymentCount === 1 &&
    report.creationEventCount === 1 &&
    report.responseStatuses.every((s) => s === 201) &&
    new Set(report.paymentIds).size === 1 &&
    report.paymentIds.every(Boolean);
  return (
    <section aria-labelledby="race-heading" className="flex flex-col gap-4">
      <div>
        <h2 id="race-heading" className="text-subheading">
          Duplicate prevention
        </h2>
        <p className="mt-2 text-body-sm text-muted-foreground">
          Each run creates a new $25.00 USD demo payment. No provider call.
        </p>
      </div>
      <Button
        variant="outline"
        disabled={run.isPending}
        onClick={() =>
          run.mutate({
            scenario: 'duplicate_request',
            amount: 2500,
            currency: 'USD',
          })
        }
      >
        Run two identical requests
      </Button>
      <Button
        variant="outline"
        disabled={run.isPending}
        onClick={() =>
          run.mutate({
            scenario: 'concurrent_requests',
            amount: 2500,
            currency: 'USD',
          })
        }
      >
        Race ten requests
      </Button>
      {run.isPending ? <p role="status">Running real HTTP requests…</p> : null}
      <RequestFeedback error={run.error} />
      {report ? (
        <Alert role="status">
          <AlertTitle>
            {passed ? 'Assertions passed' : 'Assertions failed'}
          </AlertTitle>
          <AlertDescription>
            <p>
              Unique payments: {report.uniquePaymentCount}. Creation events:{' '}
              {report.creationEventCount}.
            </p>
            <p className="break-words">
              HTTP statuses: {report.responseStatuses.join(', ')}.
            </p>
            <p className="break-all">Run: {report.runId}</p>
            <details>
              <summary>Inspect every observation</summary>
              <p className="break-all">Request key: {report.idempotencyKey}</p>
              <ol className="flex list-decimal flex-col gap-2 pl-4">
                {report.paymentIds.map((id, i) => (
                  <li key={i} className="break-all">
                    {report.responseStatuses[i]} · {id ?? 'No payment returned'}
                  </li>
                ))}
              </ol>
            </details>
            {report.paymentIds[0] ? (
              <Link href={`/payments/${report.paymentIds[0]}`} prefetch={false}>
                Inspect run payment
              </Link>
            ) : null}
          </AlertDescription>
        </Alert>
      ) : null}
    </section>
  );
}
