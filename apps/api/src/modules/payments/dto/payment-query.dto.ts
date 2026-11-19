import type { PaymentStatus } from '../../../generated/prisma/client.js';
import {
  eventCursor,
  listCursor,
  queryFields,
  queryLimit,
  queryStatus,
} from '../payment-validation.js';

// Transport strings are explicitly validated/decoded; money is never coerced.
export class ListPaymentsQueryDto {
  constructor(
    readonly limit: number,
    readonly status: PaymentStatus | null,
    readonly cursor: { createdAt: Date; id: string } | null,
  ) {}

  static parse(query: Record<string, unknown>): ListPaymentsQueryDto {
    queryFields(query, ['status', 'limit', 'cursor']);
    const status = queryStatus(query.status);
    return new ListPaymentsQueryDto(
      queryLimit(query.limit, 20),
      status,
      listCursor(query.cursor, status),
    );
  }
}

export class ListPaymentEventsQueryDto {
  constructor(
    readonly limit: number,
    readonly cursor: bigint | null,
  ) {}

  static parse(query: Record<string, unknown>): ListPaymentEventsQueryDto {
    queryFields(query, ['limit', 'cursor']);
    return new ListPaymentEventsQueryDto(
      queryLimit(query.limit, 50),
      eventCursor(query.cursor),
    );
  }
}
