import { Injectable } from '@nestjs/common';
import type { Prisma } from '../../../generated/prisma/client.js';
import { ApiError } from '../../../shared/http/api-error.js';
import {
  projectObservation,
  type ValidatedPaymentObservation,
} from '../payment-state-machine.js';

@Injectable()
export class PaymentStatusService {
  // Internal use only: the caller supplies its transaction and a validated observation.
  // PaymentSyncService checks fenced ownership before invoking this helper.
  async apply(
    tx: Prisma.TransactionClient,
    paymentId: string,
    observation: ValidatedPaymentObservation,
    audit: { webhookEventId?: string; details?: Record<string, string> } = {},
  ) {
    await tx.$queryRaw`SELECT id FROM payments WHERE id = ${paymentId}::uuid FOR UPDATE`;
    const payment = await tx.payment.findUnique({ where: { id: paymentId } });
    if (!payment)
      throw new ApiError('PAYMENT_NOT_FOUND', 404, 'Payment not found.');
    const transition = projectObservation(payment.status, observation);
    if (!transition.changed) return payment;
    const updated = await tx.payment.update({
      where: { id: paymentId },
      data: { status: transition.status, statusVersion: { increment: 1 } },
    });
    await tx.paymentEvent.create({
      data: {
        paymentId,
        type: 'PAYMENT_STATUS_CHANGED',
        fromStatus: payment.status,
        toStatus: updated.status,
        statusVersion: updated.statusVersion,
        webhookEventId: audit.webhookEventId,
        details: { source: observation.source, ...audit.details },
      },
    });
    return updated;
  }
}
