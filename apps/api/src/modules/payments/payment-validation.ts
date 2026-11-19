import { createHash } from 'node:crypto';
import type { Request } from 'express';
import { PaymentStatus } from '../../generated/prisma/client.js';
import { invalid } from '../../shared/http/api-error.js';
import type { CreatePaymentDto } from './dto/create-payment.dto.js';

export const CREATE_SCOPE = 'demo:create-payment:v1';
export const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function paymentId(value: string): string {
  if (!UUID_PATTERN.test(value)) invalid('id', 'Expected a UUID.');
  return value.toLowerCase();
}

export function idempotencyKey(request: Pick<Request, 'rawHeaders'>): string {
  const values: string[] = [];
  for (let index = 0; index < request.rawHeaders.length; index += 2) {
    if (request.rawHeaders[index]?.toLowerCase() === 'idempotency-key')
      values.push(request.rawHeaders[index + 1]!);
  }
  const key = values[0];
  if (values.length !== 1 || !key || !/^[A-Za-z0-9._:-]{16,128}$/.test(key))
    invalid(
      'Idempotency-Key',
      'Expected one ASCII key of 16–128 letters, digits, dots, underscores, colons or hyphens.',
    );
  return key;
}

export function fingerprint(body: CreatePaymentDto): string {
  return createHash('sha256')
    .update(
      JSON.stringify({ amount: body.amount, currency: body.currency }),
      'utf8',
    )
    .digest('hex');
}

export function queryFields(
  query: Record<string, unknown>,
  allowed: string[],
): void {
  if (Object.keys(query).some((key) => !allowed.includes(key)))
    invalid('query', 'Unknown query fields are not accepted.');
}

export function noBody(request: Request): void {
  if (
    request.headers['transfer-encoding'] ||
    Number(request.headers['content-length'] ?? 0) > 0
  )
    invalid('body', 'This endpoint accepts no body.');
}

export function queryLimit(value: unknown, fallback: number): number {
  if (value === undefined) return fallback;
  if (
    typeof value !== 'string' ||
    !/^[1-9][0-9]{0,2}$/.test(value) ||
    Number(value) > 100
  )
    invalid('limit', 'Expected an integer from 1 through 100.');
  return Number(value);
}

export function queryStatus(value: unknown): PaymentStatus | null {
  if (value === undefined) return null;
  if (
    typeof value !== 'string' ||
    !Object.values(PaymentStatus).includes(value as PaymentStatus)
  )
    invalid('status', 'Expected an exact payment status.');
  return value as PaymentStatus;
}

export function encodeCursor(value: object): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function decodeCursor(value: unknown): Record<string, unknown> {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > 1024 ||
    !/^[A-Za-z0-9_-]+$/.test(value)
  )
    invalid('cursor', 'Invalid cursor.');
  try {
    const bytes = Buffer.from(value, 'base64url');
    if (bytes.toString('base64url') !== value)
      invalid('cursor', 'Invalid cursor.');
    const decoded: unknown = JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(bytes),
    );
    if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded))
      invalid('cursor', 'Invalid cursor.');
    return decoded as Record<string, unknown>;
  } catch {
    return invalid('cursor', 'Invalid cursor.');
  }
}

export function listCursor(
  value: unknown,
  status: PaymentStatus | null,
): { createdAt: Date; id: string } | null {
  if (value === undefined) return null;
  const cursor = decodeCursor(value);
  if (
    Object.keys(cursor).sort().join(',') !== 'createdAt,id,status' ||
    cursor.status !== status ||
    typeof cursor.id !== 'string' ||
    !UUID_PATTERN.test(cursor.id) ||
    typeof cursor.createdAt !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(cursor.createdAt)
  )
    invalid('cursor', 'Invalid cursor or status filter mismatch.');
  const createdAt = new Date(cursor.createdAt);
  if (
    !Number.isFinite(createdAt.getTime()) ||
    createdAt.toISOString() !== cursor.createdAt
  )
    invalid('cursor', 'Invalid cursor timestamp.');
  return { createdAt, id: cursor.id.toLowerCase() };
}

export function eventCursor(value: unknown): bigint | null {
  if (value === undefined) return null;
  const cursor = decodeCursor(value);
  if (
    Object.keys(cursor).join(',') !== 'id' ||
    typeof cursor.id !== 'string' ||
    !/^[1-9][0-9]{0,18}$/.test(cursor.id) ||
    BigInt(cursor.id) > 9223372036854775807n
  )
    invalid('cursor', 'Expected a positive bigint event cursor.');
  return BigInt(cursor.id);
}
