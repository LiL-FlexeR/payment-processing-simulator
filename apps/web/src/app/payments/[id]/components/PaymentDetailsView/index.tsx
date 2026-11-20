'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePaymentQuery } from '@/api/hooks/payments/usePaymentQuery';
import { useSyncPaymentMutation } from '@/api/hooks/payments/useSyncPaymentMutation';
import { PaymentStatus } from '@/components/shared/PaymentStatus';
import { RequestFeedback } from '@/components/shared/RequestFeedback';
import { Button } from '@/components/ui/button';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { Separator } from '@/components/ui/separator';
import { formatMoney } from '@/utils/money';
import { ConfirmationPanel } from '../ConfirmationPanel';
import { RecoveryScenarios } from '../RecoveryScenarios';
import { PaymentTimeline } from '../PaymentTimeline';
export function PaymentDetailsView({
  id,
  simulation,
  returned,
}: {
  id: string;
  simulation: boolean;
  returned: boolean;
}) {
  const [startedAt, setStartedAt] = useState(() => Date.now());
  const query = usePaymentQuery(id, startedAt);
  const sync = useSyncPaymentMutation(id);
  const didReturn = useRef(false);
  useEffect(() => {
    if (returned && !didReturn.current) {
      didReturn.current = true;
      sync.mutate();
      window.history.replaceState(null, '', `/payments/${id}`);
    }
  }, [returned, id, sync]);
  const p = query.data;
  const terminal = p && ['SUCCEEDED', 'CANCELED'].includes(p.status);
  return (
    <div className="flex flex-col gap-[var(--spacing-32)]">
      <Link href="/payments" prefetch={false} className="w-fit underline">
        Back to payments
      </Link>
      <RequestFeedback error={query.error || sync.error} />
      {query.isPending ? <p role="status">Loading payment…</p> : null}
      {p ? (
        <>
          <header className="flex flex-wrap items-start justify-between gap-6">
            <div className="flex min-w-0 flex-col gap-4">
              <h1 className="text-heading-lg tracking-[var(--tracking-heading-lg)]">
                {formatMoney(p.amount, p.currency)}
              </h1>
              <p className="break-all text-body-sm">Payment {p.id}</p>
              <div role="status" aria-label="Current financial status">
                <PaymentStatus status={p.status} />
              </div>
            </div>
            <div className="flex flex-wrap gap-4">
              <Button
                variant="outline"
                disabled={query.isFetching}
                onClick={() => {
                  setStartedAt(Date.now());
                  void query.refetch();
                }}
              >
                Refresh details
              </Button>
              <Button
                disabled={sync.isPending || !p.stripePaymentIntentId}
                onClick={() => {
                  setStartedAt(Date.now());
                  sync.mutate();
                }}
              >
                {sync.isPending
                  ? 'Synchronizing…'
                  : 'Synchronize with provider'}
              </Button>
            </div>
          </header>
          <p className="text-body-sm text-muted-foreground">
            Details poll every two seconds for up to 60 seconds; terminal
            outcomes stop polling. Refresh restarts observation. Synchronization
            retrieves the existing intent.
          </p>
          {p.provisioningStatus === 'RETRYABLE' ||
          p.provisioningStatus === 'BLOCKED' ||
          p.provisioningStatus === 'REVIEW_REQUIRED' ? (
            <Alert>
              <AlertTitle>Operational state: {p.provisioningStatus}</AlertTitle>
              <AlertDescription>
                <p>
                  Financial status is preserved.{' '}
                  {p.lastProviderErrorCode ??
                    'Provider observation needs attention'}
                  .
                </p>
                <p>
                  {p.nextProviderRetryAt
                    ? `Retry eligible after ${p.nextProviderRetryAt}.`
                    : 'Review provider evidence before continuing.'}
                </p>
                {!p.stripePaymentIntentId ? (
                  <p>
                    Use Recover confirmation session to recover the original
                    provider operation.
                  </p>
                ) : null}
              </AlertDescription>
            </Alert>
          ) : null}
          <dl
            aria-label="Payment details"
            className="grid gap-x-8 gap-y-6 border-y border-border py-[var(--spacing-32)] sm:grid-cols-2 lg:grid-cols-3"
          >
            {Object.entries({
              'Provider intent': p.stripePaymentIntentId ?? 'Not linked',
              'Provider status': p.providerStatus ?? 'Not observed',
              Provisioning: p.provisioningStatus,
              'Created (UTC)': p.createdAt,
              'Updated (UTC)': p.updatedAt,
              'Last synchronized (UTC)': p.lastSyncedAt ?? 'Never',
              'Next provider retry (UTC)': p.nextProviderRetryAt ?? 'No delay',
              'Safe provider error': p.lastProviderErrorCode ?? 'None',
              'Status version': String(p.statusVersion),
            }).map(([label, value]) => (
              <div key={label} className="flex min-w-0 flex-col gap-2">
                <dt className="text-body-sm text-muted-foreground">{label}</dt>
                <dd
                  className="break-all text-body-sm tabular-nums"
                  data-testid={
                    label === 'Provider intent' ? 'provider-intent' : undefined
                  }
                >
                  {value}
                </dd>
              </div>
            ))}
          </dl>
          <div className="grid items-start gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <div className="flex min-w-0 flex-col gap-[var(--spacing-32)]">
              {terminal ? (
                <Alert role="status">
                  <AlertTitle>Terminal outcome verified</AlertTitle>
                  <AlertDescription>
                    Confirmation is closed. Synchronization can still observe
                    this same intent.
                  </AlertDescription>
                </Alert>
              ) : (
                <ConfirmationPanel key={p.id} payment={p} />
              )}
              {simulation ? (
                <>
                  <Separator />
                  <RecoveryScenarios id={p.id} />
                </>
              ) : null}
            </div>
            <PaymentTimeline
              id={id}
              version={`${p.statusVersion}:${p.updatedAt}`}
            />
          </div>
        </>
      ) : null}
    </div>
  );
}
