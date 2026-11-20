'use client';
import { useState } from 'react';
import Link from 'next/link';
import { RefreshCw } from 'lucide-react';
import { usePaymentsQuery } from '@/api/hooks/payments/usePaymentsQuery';
import { paymentStatuses } from '@/api/payments.types';
import { formatMoney } from '@/utils/money';
import { Button } from '@/components/ui/button';
import {
  NativeSelect,
  NativeSelectOption,
} from '@/components/ui/native-select';
import {
  Table,
  TableHeader,
  TableHead,
  TableBody,
  TableCell,
  TableRow,
  TableCaption,
} from '@/components/ui/table';
import {
  Empty,
  EmptyHeader,
  EmptyTitle,
  EmptyDescription,
} from '@/components/ui/empty';
import { Skeleton } from '@/components/ui/skeleton';
import { PaymentStatus } from '@/components/shared/PaymentStatus';
import { RequestFeedback } from '@/components/shared/RequestFeedback';
export function PaymentList() {
  const [status, setStatus] = useState('');
  const [cursors, setCursors] = useState<(string | undefined)[]>([undefined]);
  const query = usePaymentsQuery(status, cursors.at(-1));
  return (
    <section
      aria-labelledby="list-heading"
      className="flex min-w-0 flex-col gap-6"
    >
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 id="list-heading" className="text-subheading">
            Payment ledger
          </h2>
          <p className="mt-2 text-body-sm text-muted-foreground">
            Current local status, backed by provider observations.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void query.refetch()}
          disabled={query.isFetching}
        >
          <RefreshCw data-icon="inline-start" aria-hidden="true" />
          Refresh list
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-4">
        <label htmlFor="status-filter" className="text-body-sm">
          Status
        </label>
        <NativeSelect
          id="status-filter"
          name="status"
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setCursors([undefined]);
          }}
        >
          <NativeSelectOption value="">All statuses</NativeSelectOption>
          {paymentStatuses.map((s) => (
            <NativeSelectOption key={s} value={s}>
              {s === 'FAILED'
                ? 'Declined (retryable)'
                : s[0] + s.slice(1).toLowerCase()}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </div>
      <RequestFeedback error={query.error} />
      {query.isPending ? (
        <div
          role="status"
          aria-label="Loading payments"
          className="flex flex-col gap-4"
        >
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      ) : query.data?.items.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyTitle>No payments here yet</EmptyTitle>
            <EmptyDescription>
              Create a payment or choose another status.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : query.data ? (
        <>
          <Table>
            <TableCaption>Newest first. Times shown in UTC.</TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead scope="col">Payment</TableHead>
                <TableHead scope="col" className="text-right">
                  Amount
                </TableHead>
                <TableHead scope="col">Status</TableHead>
                <TableHead scope="col">Created (UTC)</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {query.data.items.map((p) => (
                <TableRow key={p.id}>
                  <TableCell>
                    <Link
                      href={`/payments/${p.id}`}
                      prefetch={false}
                      className="inline-flex min-h-12 items-center underline"
                      title={p.id}
                    >
                      {p.id.slice(0, 8)}
                    </Link>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatMoney(p.amount, p.currency)}
                  </TableCell>
                  <TableCell>
                    <PaymentStatus status={p.status} />
                  </TableCell>
                  <TableCell>
                    <time dateTime={p.createdAt}>
                      {p.createdAt.slice(0, 16).replace('T', ' ')}
                    </time>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <div className="flex flex-wrap items-center justify-between gap-4">
            <p className="text-body-sm text-muted-foreground">
              Page {cursors.length} · {query.data.items.length} payments
            </p>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={cursors.length === 1 || query.isFetching}
                onClick={() => setCursors((c) => c.slice(0, -1))}
              >
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={!query.data.nextCursor || query.isFetching}
                onClick={() =>
                  setCursors((c) => [...c, query.data!.nextCursor!])
                }
              >
                Next
              </Button>
            </div>
          </div>
        </>
      ) : null}
    </section>
  );
}
