'use client';
import dynamic from 'next/dynamic';
import { useQueryClient } from '@tanstack/react-query';
import { useConfirmationSession } from './hooks/useConfirmationSession';
import { useFakeConfirmMutation } from '@/api/hooks/simulation/useScenarioMutations';
import type { PaymentDetails } from '@/api/payments.types';
import { formatMoney } from '@/utils/money';
import { Button } from '@/components/ui/button';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { RequestFeedback } from '@/components/shared/RequestFeedback';
const StripeConfirmation = dynamic(
  () => import('../StripeConfirmation').then((m) => m.StripeConfirmation),
  { ssr: false },
);
export function ConfirmationPanel({ payment }: { payment: PaymentDetails }) {
  const { session, busy, error, open } = useConfirmationSession(payment.id);
  const confirmation = useFakeConfirmMutation(payment.id);
  const cache = useQueryClient();
  return (
    <section
      aria-labelledby="confirmation-heading"
      className="flex flex-col gap-4"
    >
      <div>
        <h2 id="confirmation-heading" className="text-subheading">
          Test confirmation
        </h2>
        <p className="mt-2 text-body-sm text-muted-foreground">
          Use the existing payment intent. Confirmation is never retried
          automatically.
        </p>
      </div>
      <RequestFeedback error={error || confirmation.error} />
      {!session ? (
        <Button
          onClick={() => void open()}
          disabled={
            busy ||
            payment.provisioningStatus === 'REVIEW_REQUIRED' ||
            payment.provisioningStatus === 'BLOCKED' ||
            payment.providerStatus === 'processing'
          }
        >
          {busy
            ? 'Opening…'
            : payment.provisioningStatus === 'RETRYABLE'
              ? 'Recover confirmation session'
              : 'Open confirmation session'}
        </Button>
      ) : session.provider === 'fake' ? (
        <>
          <Alert role="note">
            <AlertTitle>Fixed fake-provider confirmation</AlertTitle>
            <AlertDescription>
              No card entry or real Stripe call. Each action delivers a signed
              fixture through the normal webhook endpoint.
            </AlertDescription>
          </Alert>
          <div className="flex flex-wrap gap-4">
            <Button
              disabled={confirmation.isPending}
              onClick={() => confirmation.mutate('success')}
            >
              Confirm fake success
            </Button>
            <Button
              variant="outline"
              disabled={confirmation.isPending}
              onClick={() => confirmation.mutate('decline')}
            >
              Confirm fake decline
            </Button>
          </div>
        </>
      ) : (
        <StripeConfirmation
          session={session}
          amount={formatMoney(payment.amount, payment.currency)}
          onObserved={async () => {
            await cache.invalidateQueries({ queryKey: ['payments'] });
          }}
        />
      )}
      {confirmation.data ? (
        <Alert role="status">
          <AlertTitle>Signed confirmation delivery</AlertTitle>
          <AlertDescription>
            <p className="break-all">Event: {confirmation.data.eventId}</p>
            <p>
              Webhook HTTP {confirmation.data.deliveryStatus}.{' '}
              {confirmation.data.deliveryStatus === 200
                ? 'Read the synchronized status above.'
                : 'Provider outcome may already have changed. Recover by replaying this event or synchronizing; do not reconfirm.'}
            </p>
          </AlertDescription>
        </Alert>
      ) : null}
    </section>
  );
}
