import { Check, Circle, CircleX, Clock, OctagonX } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import type { PaymentStatus as Status } from '@/api/payments.types';
const labels: Record<Status, string> = {
  CREATED: 'Created',
  PENDING: 'Pending',
  FAILED: 'Attempt declined; retry possible',
  SUCCEEDED: 'Succeeded',
  CANCELED: 'Canceled',
};
const icons = {
  CREATED: Circle,
  PENDING: Clock,
  FAILED: CircleX,
  SUCCEEDED: Check,
  CANCELED: OctagonX,
};
export function PaymentStatus({ status }: { status: Status }) {
  const Icon = icons[status];
  return (
    <Badge variant={status === 'SUCCEEDED' ? 'accent' : 'outline'}>
      <Icon className="size-4" strokeWidth={1.5} aria-hidden="true" />
      {labels[status]}
    </Badge>
  );
}
