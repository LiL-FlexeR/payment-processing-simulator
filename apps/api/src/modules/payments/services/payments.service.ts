import { randomInt, randomUUID } from 'node:crypto';
import { setTimeout } from 'node:timers/promises';
import { Injectable } from '@nestjs/common';
import { Prisma } from '../../../generated/prisma/client.js';
import { DatabaseService } from '../../../shared/database/database.service.js';
import {
  isIdempotencyConflict,
  isTransactionConflict,
} from '../../../shared/database/database-errors.js';
import {
  ApiError,
  databaseUnavailable,
} from '../../../shared/http/api-error.js';
import { CreatePaymentDto } from '../dto/create-payment.dto.js';
import type {
  ListPaymentsQueryDto,
  ListPaymentEventsQueryDto,
} from '../dto/payment-query.dto.js';
import {
  CreationRepresentationDto,
  PaymentDetailsDto,
  PaymentEventDto,
  PaymentSummaryDto,
} from '../dto/payment-response.dto.js';
import {
  CREATE_SCOPE,
  encodeCursor,
  fingerprint,
} from '../payment-validation.js';

@Injectable()
export class PaymentsService {
  constructor(private readonly database: DatabaseService) {}

  private async replay(key: string, hash: string) {
    const winner = await this.database.idempotencyRecord.findUnique({
      where: { scope_key: { scope: CREATE_SCOPE, key } },
    });
    if (!winner) throw databaseUnavailable();
    if (winner.requestHash !== hash)
      throw new ApiError(
        'IDEMPOTENCY_KEY_REUSED',
        409,
        'This key was already used with a different request.',
      );
    return {
      body: CreationRepresentationDto.fromSnapshot(winner.responseBody),
      replayed: true,
    };
  }

  async create(key: string, body: CreatePaymentDto) {
    const hash = fingerprint(body);
    const id = randomUUID();
    // No fast-path read is needed: the unique insert arbitrates every race.
    for (let attempt = 0; ; attempt++) {
      try {
        const snapshot = await this.database.$transaction(
          async (tx) => {
            const payment = await tx.payment.create({
              data: {
                id,
                amount: body.amount,
                currency: body.currency,
                providerOperationKey: `pps:pi:create:v1:${id}`,
              },
            });
            const response = CreationRepresentationDto.fromPayment(payment);
            await tx.paymentEvent.create({
              data: {
                paymentId: id,
                type: 'PAYMENT_CREATED',
                toStatus: 'CREATED',
                statusVersion: 1,
                details: { source: 'api' },
              },
            });
            await tx.idempotencyRecord.create({
              data: {
                id: randomUUID(),
                scope: CREATE_SCOPE,
                key,
                requestHash: hash,
                paymentId: id,
                responseStatus: 201,
                responseBody: { ...response },
              },
            });
            return response;
          },
          {
            isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
            maxWait: 2000,
            timeout: 5000,
          },
        );
        return { body: snapshot, replayed: false };
      } catch (error) {
        // This catch runs after the entire losing T1 has rolled back.
        if (isIdempotencyConflict(error)) return this.replay(key, hash);
        if (!isTransactionConflict(error)) throw error;
        if (attempt >= 3) throw databaseUnavailable();
        await setTimeout(randomInt(10, 31) * (attempt + 1));
      }
    }
  }

  async list({ status, limit, cursor }: ListPaymentsQueryDto) {
    const where: Prisma.PaymentWhereInput = {
      ...(status ? { status } : {}),
      ...(cursor
        ? {
            OR: [
              { createdAt: { lt: cursor.createdAt } },
              { createdAt: cursor.createdAt, id: { lt: cursor.id } },
            ],
          }
        : {}),
    };
    const rows = await this.database.payment.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });
    const items = rows.slice(0, limit).map(PaymentSummaryDto.fromPayment);
    const last = items.at(-1);
    return {
      items,
      nextCursor:
        rows.length > limit && last
          ? encodeCursor({ createdAt: last.createdAt, id: last.id, status })
          : null,
    };
  }

  async details(id: string) {
    const payment = await this.database.payment.findUnique({ where: { id } });
    if (!payment)
      throw new ApiError('PAYMENT_NOT_FOUND', 404, 'Payment not found.');
    return PaymentDetailsDto.fromPayment(payment);
  }

  async events(id: string, { limit, cursor }: ListPaymentEventsQueryDto) {
    await this.details(id);
    const rows = await this.database.paymentEvent.findMany({
      where: { paymentId: id, ...(cursor ? { id: { lt: cursor } } : {}) },
      orderBy: { id: 'desc' },
      take: limit + 1,
    });
    const items = rows.slice(0, limit).map(PaymentEventDto.fromEvent);
    const last = items.at(-1);
    return {
      items,
      nextCursor:
        rows.length > limit && last ? encodeCursor({ id: last.id }) : null,
    };
  }
}
