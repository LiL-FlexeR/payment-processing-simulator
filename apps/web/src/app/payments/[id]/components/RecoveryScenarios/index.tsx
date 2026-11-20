'use client';
import { useState } from 'react';
import {
  useFaultMutation,
  useReplayMutation,
} from '@/api/hooks/simulation/useScenarioMutations';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field, FieldLabel } from '@/components/ui/field';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { RequestFeedback } from '@/components/shared/RequestFeedback';
export function RecoveryScenarios({ id }: { id: string }) {
  const fault = useFaultMutation(id);
  const replay = useReplayMutation();
  const [eventId, setEventId] = useState('');
  const [invalid, setInvalid] = useState(false);
  const report = replay.data;
  const passed =
    report &&
    report.deliveryStatuses.every((s) => s === 200) &&
    report.processingStatus === 'PROCESSED' &&
    report.financialTransitionCount <= 1;
  return (
    <section aria-labelledby="recovery-heading" className="flex flex-col gap-4">
      <div>
        <h2 id="recovery-heading" className="text-subheading">
          Failure & recovery lab
        </h2>
        <p className="mt-2 text-body-sm text-muted-foreground">
          One fault per payment, consumed once, expires after 60 seconds.
        </p>
      </div>
      <div className="flex flex-wrap gap-4">
        <Button
          variant="outline"
          disabled={fault.isPending}
          onClick={() => fault.mutate('webhook_before_commit')}
        >
          Arm webhook rollback
        </Button>
        <Button
          variant="outline"
          disabled={fault.isPending}
          onClick={() => fault.mutate('provider_response_timeout')}
        >
          Arm provider response timeout
        </Button>
      </div>
      {fault.data ? (
        <p role="status" className="break-words text-body-sm">
          Armed {fault.data.point}. Expires {fault.data.expiresAt}. A processed
          event bypasses the rollback fault; confirm a new outcome first.
        </p>
      ) : null}
      <RequestFeedback error={fault.error || replay.error} />
      <form
        method="post"
        aria-label="Replay signed event"
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (!/^evt_[A-Za-z0-9_]{1,200}$/.test(eventId)) {
            setInvalid(true);
            return;
          }
          setInvalid(false);
          replay.mutate(eventId);
        }}
      >
        <Field data-invalid={invalid}>
          <FieldLabel htmlFor="event-id">Observed webhook event ID</FieldLabel>
          <Input
            id="event-id"
            name="eventId"
            value={eventId}
            required
            spellCheck={false}
            autoComplete="off"
            aria-invalid={invalid}
            aria-describedby={invalid ? 'event-error' : undefined}
            onChange={(e) => {
              setEventId(e.target.value);
              setInvalid(false);
            }}
          />
          {invalid ? (
            <p id="event-error" role="alert">
              Enter an observed event ID beginning with evt_.
            </p>
          ) : null}
        </Field>
        <Button type="submit" variant="outline" disabled={replay.isPending}>
          Replay signed event twice
        </Button>
      </form>
      {report ? (
        <Alert role="status">
          <AlertTitle>
            {passed
              ? 'Replay assertions passed'
              : 'Replay assertions failed or recovery pending'}
          </AlertTitle>
          <AlertDescription>
            <p>
              Delivery HTTP: {report.deliveryStatuses.join(', ')}. Stored
              deliveries: {report.storedDeliveryCount}.
            </p>
            <p>
              Processing: {report.processingStatus}. Financial transitions for
              this event: {report.financialTransitionCount}.
            </p>
          </AlertDescription>
        </Alert>
      ) : null}
    </section>
  );
}
