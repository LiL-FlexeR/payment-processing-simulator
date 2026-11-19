import { createHash } from 'node:crypto';
import { jest } from '@jest/globals';
import { Prisma, PaymentStatus } from '../../generated/prisma/client.js';
import { ApiError } from '../../shared/http/api-error.js';
import {
  isDatabaseUnavailable,
  isIdempotencyConflict,
  isTransactionConflict,
} from '../../shared/database/database-errors.js';
import { DatabaseService } from '../../shared/database/database.service.js';
import { CreatePaymentDto } from './dto/create-payment.dto.js';
import {
  encodeCursor,
  eventCursor,
  fingerprint,
  idempotencyKey,
  listCursor,
  queryLimit,
  queryStatus,
} from './payment-validation.js';
import {
  InvalidPaymentTransition,
  projectObservation,
  transitionPaymentStatus,
} from './payment-state-machine.js';
import { PaymentsService } from './services/payments.service.js';

const states = Object.values(PaymentStatus);
const allowed = new Set([
  'CREATED:PENDING',
  'CREATED:FAILED',
  'CREATED:SUCCEEDED',
  'CREATED:CANCELED',
  'PENDING:FAILED',
  'PENDING:SUCCEEDED',
  'PENDING:CANCELED',
  'FAILED:PENDING',
  'FAILED:SUCCEEDED',
  'FAILED:CANCELED',
]);
const knownError = (code: string, meta?: Record<string, unknown>) =>
  new Prisma.PrismaClientKnownRequestError('private database data', {
    code,
    clientVersion: '7.10.1',
    meta,
  });

describe('pure payment lifecycle', () => {
  it.each(states.flatMap((from) => states.map((to) => [from, to] as const)))(
    '%s -> %s',
    (from, to) => {
      if (from === to)
        expect(transitionPaymentStatus(from, to)).toEqual({
          status: from,
          changed: false,
        });
      else if (allowed.has(`${from}:${to}`))
        expect(transitionPaymentStatus(from, to)).toEqual({
          status: to,
          changed: true,
        });
      else
        expect(() => transitionPaymentStatus(from, to)).toThrow(
          InvalidPaymentTransition,
        );
    },
  );
  it.each(['AWAITING_PAYMENT', 'ACTION_REQUIRED', 'PROCESSING'] as const)(
    'projects %s as pending',
    (phase) => {
      expect(projectObservation('CREATED', { phase, source: 'test' })).toEqual({
        status: 'PENDING',
        changed: true,
      });
    },
  );
  it('rejects an unsupported phase without a financial status', () => {
    expect(() =>
      projectObservation('PENDING', { phase: 'UNSUPPORTED', source: 'test' }),
    ).toThrow(InvalidPaymentTransition);
  });
});

describe('strict creation validation and canonical identity', () => {
  it.each([100, 1000000])('accepts inclusive amount %s', (amount) =>
    expect(CreatePaymentDto.parse({ amount, currency: ' eUr ' })).toEqual({
      amount,
      currency: 'EUR',
    }),
  );
  it.each([
    undefined,
    null,
    '100',
    99,
    1000001,
    100.01,
    NaN,
    Infinity,
    true,
    {},
    [],
  ])('rejects amount %j', (amount) =>
    expect(() => CreatePaymentDto.parse({ amount, currency: 'USD' })).toThrow(
      ApiError,
    ),
  );
  it.each([null, 42, '', 'GBP', 'US D', ['USD']])(
    'rejects currency %j',
    (currency) =>
      expect(() => CreatePaymentDto.parse({ amount: 100, currency })).toThrow(
        ApiError,
      ),
  );
  it.each([
    null,
    [],
    'body',
    10,
    {},
    { amount: 100, currency: 'USD', status: 'SUCCEEDED' },
  ])('rejects body %j', (body) =>
    expect(() => CreatePaymentDto.parse(body)).toThrow(ApiError),
  );
  it('hashes exactly the canonical UTF-8 object regardless of input order or currency spelling', () => {
    const expected = createHash('sha256')
      .update('{"amount":2500,"currency":"USD"}')
      .digest('hex');
    expect(
      fingerprint(CreatePaymentDto.parse({ currency: ' usd ', amount: 2500 })),
    ).toBe(expected);
    expect(
      fingerprint(CreatePaymentDto.parse({ amount: 2600, currency: 'USD' })),
    ).not.toBe(expected);
    expect(
      fingerprint(CreatePaymentDto.parse({ amount: 2500, currency: 'EUR' })),
    ).not.toBe(expected);
  });
  it.each(['a'.repeat(16), 'A'.repeat(128), 'abcdef012345._:-'])(
    'accepts key %s',
    (key) =>
      expect(idempotencyKey({ rawHeaders: ['Idempotency-Key', key] })).toBe(
        key,
      ),
  );
  it.each([
    'a'.repeat(15),
    'a'.repeat(129),
    'bad key with spaces',
    'ab,cdef0123456789',
    'ü'.repeat(16),
    ' abcdef0123456789',
  ])('rejects invalid key %s', (key) =>
    expect(() =>
      idempotencyKey({ rawHeaders: ['idempotency-key', key] }),
    ).toThrow(ApiError),
  );
  it('rejects absent and duplicate key headers', () => {
    expect(() => idempotencyKey({ rawHeaders: [] })).toThrow(ApiError);
    expect(() =>
      idempotencyKey({
        rawHeaders: [
          'Idempotency-Key',
          'a'.repeat(16),
          'IDEMPOTENCY-KEY',
          'a'.repeat(16),
        ],
      }),
    ).toThrow(ApiError);
  });
});

describe('cursor and query validation', () => {
  const tuple = {
    createdAt: '2026-11-19T01:00:00.000Z',
    id: '9d576a31-e423-4422-9a4c-c1346ad6534e',
    status: 'PENDING',
  };
  it('checks the exact tuple, timestamp and filter', () => {
    expect(
      listCursor(encodeCursor(tuple), 'PENDING')?.createdAt.toISOString(),
    ).toBe(tuple.createdAt);
    expect(() => listCursor(encodeCursor(tuple), null)).toThrow(ApiError);
    expect(() =>
      listCursor(
        encodeCursor({ ...tuple, createdAt: '2026-02-30T01:00:00.000Z' }),
        'PENDING',
      ),
    ).toThrow(ApiError);
    expect(() =>
      listCursor(encodeCursor({ ...tuple, extra: 1 }), 'PENDING'),
    ).toThrow(ApiError);
    expect(() =>
      listCursor(encodeCursor({ ...tuple, id: 'bad' }), 'PENDING'),
    ).toThrow(ApiError);
  });
  it.each(['', 'not/json', 'a'.repeat(1025), 'bnVsbA', 'W10', 'eyJpZCI6MX0='])(
    'rejects malformed cursor %s',
    (cursor) => expect(() => eventCursor(cursor)).toThrow(ApiError),
  );
  it('preserves bigint precision and rejects values outside PostgreSQL bigint', () => {
    expect(eventCursor(encodeCursor({ id: '9007199254740993' }))).toBe(
      9007199254740993n,
    );
    for (const id of ['0', '-1', '01', '1.2', '9223372036854775808', 1])
      expect(() => eventCursor(encodeCursor({ id }))).toThrow(ApiError);
  });
  it.each(['0', '101', '-1', '1.5', '1e1', '01', ' 20', ['20', '21']])(
    'rejects limit %j',
    (value) => expect(() => queryLimit(value, 20)).toThrow(ApiError),
  );
  it('validates exact statuses and defaults', () => {
    expect(queryLimit(undefined, 50)).toBe(50);
    expect(queryLimit('100', 20)).toBe(100);
    expect(queryStatus(undefined)).toBeNull();
    expect(() => queryStatus('created')).toThrow(ApiError);
  });
});

describe('specific database error handling and bounded transaction retries', () => {
  it('recognizes only the scope/key constraint', () => {
    expect(
      isIdempotencyConflict(knownError('P2002', { target: ['scope', 'key'] })),
    ).toBe(true);
    expect(
      isIdempotencyConflict(
        knownError('P2002', {
          driverAdapterError: {
            cause: {
              constraint: { index: 'idempotency_records_scope_key_key' },
            },
          },
        }),
      ),
    ).toBe(true);
    for (const target of [
      ['payment_id'],
      ['provider_operation_key'],
      ['id'],
      ['scope'],
    ])
      expect(isIdempotencyConflict(knownError('P2002', { target }))).toBe(
        false,
      );
    expect(isIdempotencyConflict(new Error('scope key'))).toBe(false);
  });
  it('distinguishes transient conflicts and unavailable storage from other constraints', () => {
    expect(isTransactionConflict(knownError('P2034'))).toBe(true);
    expect(isTransactionConflict(knownError('P2010', { code: '40P01' }))).toBe(
      true,
    );
    expect(isTransactionConflict(knownError('P2003'))).toBe(false);
    expect(isDatabaseUnavailable(knownError('P2024'))).toBe(true);
    expect(isDatabaseUnavailable(knownError('P2002'))).toBe(false);
    expect(isDatabaseUnavailable(new Error('secret'))).toBe(false);
  });
  it('retries the complete local transaction and stops after at most three retries', async () => {
    const transact = jest
      .fn<DatabaseService['$transaction']>()
      .mockRejectedValue(knownError('P2034'));
    const service = new PaymentsService({
      $transaction: transact,
    } as unknown as DatabaseService);
    await expect(
      service.create('a'.repeat(16), { amount: 100, currency: 'USD' }),
    ).rejects.toMatchObject({ code: 'DATABASE_UNAVAILABLE' });
    expect(transact).toHaveBeenCalledTimes(4);
  });
  it('does not retry unrelated unique constraints or arbitrary failures', async () => {
    const error = knownError('P2002', { target: ['provider_operation_key'] });
    const transact = jest
      .fn<DatabaseService['$transaction']>()
      .mockRejectedValue(error);
    const service = new PaymentsService({
      $transaction: transact,
    } as unknown as DatabaseService);
    await expect(
      service.create('a'.repeat(16), { amount: 100, currency: 'USD' }),
    ).rejects.toBe(error);
    expect(transact).toHaveBeenCalledTimes(1);
  });
  it('returns a successful response after a transient transaction conflict', async () => {
    const snapshot = {
      id: '9d576a31-e423-4422-9a4c-c1346ad6534e',
      amount: 100,
      currency: 'USD',
      status: 'CREATED',
      createdAt: '2026-11-19T01:00:00.000Z',
    };
    const transact = jest
      .fn<DatabaseService['$transaction']>()
      .mockRejectedValueOnce(knownError('P2034'))
      .mockResolvedValueOnce(snapshot);
    const service = new PaymentsService({
      $transaction: transact,
    } as unknown as DatabaseService);
    await expect(
      service.create('a'.repeat(16), { amount: 100, currency: 'USD' }),
    ).resolves.toEqual({ body: snapshot, replayed: false });
    expect(transact).toHaveBeenCalledTimes(2);
  });
  it('uses a fresh winner read after rollback and returns retryable unavailability if it cannot be read', async () => {
    const transact = jest
      .fn<DatabaseService['$transaction']>()
      .mockRejectedValue(knownError('P2002', { target: ['scope', 'key'] }));
    const find = jest
      .fn<DatabaseService['idempotencyRecord']['findUnique']>()
      .mockResolvedValue(null);
    const service = new PaymentsService({
      $transaction: transact,
      idempotencyRecord: { findUnique: find },
    } as unknown as DatabaseService);
    await expect(
      service.create('a'.repeat(16), { amount: 100, currency: 'USD' }),
    ).rejects.toMatchObject({ code: 'DATABASE_UNAVAILABLE' });
    expect(transact).toHaveBeenCalledTimes(1);
    expect(find).toHaveBeenCalledWith({
      where: {
        scope_key: { scope: 'demo:create-payment:v1', key: 'a'.repeat(16) },
      },
    });
  });
});
