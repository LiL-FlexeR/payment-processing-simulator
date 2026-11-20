'use client';
import { usePaymentEventsQuery } from '@/api/hooks/payments/usePaymentEventsQuery';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { RequestFeedback } from '@/components/shared/RequestFeedback';
export function PaymentTimeline({
  id,
  version,
}: {
  id: string;
  version: string;
}) {
  const events = usePaymentEventsQuery(id, version);
  return (
    <section aria-labelledby="history-heading" className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 id="history-heading" className="text-subheading">
            Audit timeline
          </h2>
          <p className="mt-2 text-body-sm text-muted-foreground">
            Newest first. Only committed financial transitions receive a
            version.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          disabled={events.isFetching}
          onClick={() => void events.refetch()}
        >
          Refresh history
        </Button>
      </div>
      <RequestFeedback error={events.error} />
      {events.isPending ? <p role="status">Loading history…</p> : null}
      <ol className="flex flex-col divide-y divide-border">
        {events.data?.pages
          .flatMap((page) => page.items)
          .map((event) => (
            <li key={event.id} className="flex flex-col gap-2 py-6 first:pt-0">
              <div className="flex flex-wrap items-center gap-3">
                <h3 className="text-body">
                  {event.type.toLowerCase().replaceAll('_', ' ')}
                </h3>
                {event.statusVersion ? (
                  <Badge variant="accent">Version {event.statusVersion}</Badge>
                ) : null}
              </div>
              {event.toStatus ? (
                <p className="text-body-sm">
                  {event.fromStatus ?? 'New'} → {event.toStatus}
                </p>
              ) : null}
              <time
                dateTime={event.createdAt}
                className="text-body-sm text-muted-foreground"
              >
                {event.createdAt.replace('T', ' ').replace('Z', ' UTC')}
              </time>
              {event.webhookEventId ? (
                <p className="break-all text-body-sm">
                  Webhook: {event.webhookEventId}
                </p>
              ) : null}
              <dl className="flex flex-col gap-1 text-body-sm">
                {Object.entries(event.details).map(([key, value]) => (
                  <div key={key} className="flex flex-wrap gap-x-2">
                    <dt>{key}:</dt>
                    <dd className="break-all">{value}</dd>
                  </div>
                ))}
              </dl>
            </li>
          ))}
      </ol>
      {events.hasNextPage ? (
        <Button
          variant="outline"
          disabled={events.isFetchingNextPage}
          onClick={() => void events.fetchNextPage()}
        >
          Load older events
        </Button>
      ) : null}
    </section>
  );
}
