import { Prisma } from '../../generated/prisma/client.js';

export function isIdempotencyConflict(error: unknown): boolean {
  if (
    !(error instanceof Prisma.PrismaClientKnownRequestError) ||
    error.code !== 'P2002'
  )
    return false;
  const target: unknown = error.meta?.target;
  if (Array.isArray(target))
    return (
      target.length === 2 && target.includes('scope') && target.includes('key')
    );
  if (target === 'idempotency_records_scope_key_key') return true;
  // Prisma 7's PostgreSQL driver adapter retains the named unique index.
  const cause = (
    error.meta?.driverAdapterError as
      { cause?: { constraint?: { index?: string } } } | undefined
  )?.cause;
  return cause?.constraint?.index === 'idempotency_records_scope_key_key';
}

export function isTransactionConflict(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    (error.code === 'P2034' ||
      (error.code === 'P2010' &&
        ['40001', '40P01'].includes(String(error.meta?.code))))
  );
}

export function isDatabaseUnavailable(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientInitializationError) return true;
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (
      ['P1001', 'P1002', 'P1008', 'P1017', 'P2024', 'P2028', 'P2037'].includes(
        error.code,
      )
    )
      return true;
    if (
      error.code === 'P2010' &&
      ['55P03', '57014', '53300', '57P01', '08006'].includes(
        String(error.meta?.code),
      )
    )
      return true;
    const cause = (
      error.meta?.driverAdapterError as
        { cause?: { kind?: string } } | undefined
    )?.cause;
    return [
      'SocketTimeout',
      'ConnectionClosed',
      'TooManyConnections',
      'DatabaseNotReachable',
    ].includes(cause?.kind ?? '');
  }
  return false;
}
