import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { PAYMENT_PROVIDER } from '../../../integrations/payment-provider.token.js';
import type { PaymentProvider } from '../../../integrations/payment-provider.interface.js';
import { ProviderFailure } from '../../../integrations/payment-provider.types.js';
import { ConfigService } from '../../../shared/config/config.service.js';
import { DatabaseService } from '../../../shared/database/database.service.js';
import { localTransaction } from '../../../shared/database/local-transaction.js';
import { ApiError } from '../../../shared/http/api-error.js';
import { PaymentLeaseService } from '../../payments/services/payment-lease.service.js';
import { CREATE_SCOPE } from '../../payments/payment-validation.js';
import type { CreatePaymentDto } from '../../payments/dto/create-payment.dto.js';
import {
  SimulationFaultRegistry,
  type FaultPoint,
} from './simulation-fault.registry.js';

@Injectable()
export class SimulationService {
  constructor(
    private readonly db: DatabaseService,
    private readonly config: ConfigService,
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
    private readonly faults: SimulationFaultRegistry,
    private readonly leases: PaymentLeaseService,
  ) {}

  private async post(
    path: string,
    body: string,
    headers: Record<string, string> = {},
  ) {
    try {
      // Never derive this target from a request Host, URL, path or body.
      return await fetch(
        `http://127.0.0.1:${this.config.values.apiPort}/api/v1/${path}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...headers },
          body,
          redirect: 'error',
          signal: AbortSignal.timeout(8500),
        },
      );
    } catch {
      throw new ApiError(
        'PROVIDER_UNAVAILABLE',
        503,
        'Local scenario delivery could not complete.',
        true,
      );
    }
  }
  async race(
    scenario: 'duplicate_request' | 'concurrent_requests',
    body: CreatePaymentDto,
  ) {
    const key = randomUUID();
    const send = async () => {
      const response = await this.post('payments', JSON.stringify(body), {
        'Idempotency-Key': key,
      });
      const value = (await response.json()) as { id?: unknown };
      return {
        status: response.status,
        id: typeof value.id === 'string' ? value.id : null,
      };
    };
    const observations =
      scenario === 'duplicate_request'
        ? [await send(), await send()]
        : await Promise.all(Array.from({ length: 10 }, send));
    const payments = await this.db.payment.findMany({
      where: { idempotencyRecord: { scope: CREATE_SCOPE, key } },
      select: { id: true },
    });
    const creationEventCount = await this.db.paymentEvent.count({
      where: {
        paymentId: { in: payments.map((p) => p.id) },
        type: 'PAYMENT_CREATED',
      },
    });
    return {
      runId: randomUUID(),
      scenario,
      idempotencyKey: key,
      paymentIds: observations.map((r) => r.id),
      responseStatuses: observations.map((r) => r.status),
      uniquePaymentCount: payments.length,
      creationEventCount,
    };
  }
  private async payment(id: string) {
    const payment = await this.db.payment.findUnique({ where: { id } });
    if (!payment)
      throw new ApiError('PAYMENT_NOT_FOUND', 404, 'Payment not found.');
    return payment;
  }
  async arm(id: string, point: FaultPoint) {
    await this.payment(id);
    return this.faults.arm(id, point);
  }
  private async deliver(raw: Buffer) {
    const response = await this.post('webhooks/stripe', raw.toString('utf8'), {
      'Stripe-Signature': this.provider.signTestEvent(raw),
    });
    await response.arrayBuffer();
    return response.status;
  }
  async replay(eventId: string) {
    const receipt = await this.db.webhookEvent.findUnique({
      where: { id: eventId },
    });
    if (
      !receipt ||
      !receipt.paymentId ||
      receipt.metadataInstanceId !== this.config.values.appInstanceId
    )
      throw new ApiError('EVENT_NOT_FOUND', 404, 'Local event not found.');
    const payment = await this.payment(receipt.paymentId);
    if (receipt.status === 'REVIEW_REQUIRED')
      throw new ApiError(
        'REVIEW_REQUIRED',
        409,
        'Event requires operator review.',
      );
    let raw: Buffer;
    try {
      raw = await this.provider.retrieveTestEvent(eventId);
    } catch (error) {
      if (error instanceof ProviderFailure && error.kind === 'transient')
        throw new ApiError(
          'PROVIDER_UNAVAILABLE',
          503,
          'Original test event retrieval is temporarily unavailable.',
          true,
        );
      throw new ApiError(
        'EVENT_UNAVAILABLE',
        409,
        'Original immutable test event is unavailable.',
      );
    }
    const event = (() => {
      try {
        return this.provider.verifyEvent(raw, this.provider.signTestEvent(raw));
      } catch {
        throw new ApiError(
          'INVALID_WEBHOOK',
          400,
          'Original event is not a valid test fixture.',
        );
      }
    })();
    if (
      event.id !== receipt.id ||
      event.type !== receipt.type ||
      event.apiVersion !== receipt.apiVersion ||
      event.providerCreatedAt.getTime() !==
        receipt.providerCreatedAt.getTime() ||
      event.livemode !== receipt.livemode ||
      event.providerObjectId !== receipt.providerObjectId ||
      event.metadataPaymentId !== payment.id ||
      event.metadataInstanceId !== receipt.metadataInstanceId ||
      event.metadataOperationKey !== receipt.metadataOperationKey ||
      event.metadataOperationKey !== payment.providerOperationKey ||
      (payment.stripePaymentIntentId &&
        event.providerObjectId !== payment.stripePaymentIntentId)
    )
      throw new ApiError(
        'INVALID_WEBHOOK',
        400,
        'Original event does not match its immutable receipt.',
      );
    const deliveryStatuses = [await this.deliver(raw), await this.deliver(raw)];
    const stored = await this.db.webhookEvent.findUniqueOrThrow({
      where: { id: eventId },
    });
    return {
      eventId,
      deliveryStatuses,
      storedDeliveryCount: stored.deliveryCount,
      processingStatus: stored.status,
      financialTransitionCount: await this.db.paymentEvent.count({
        where: {
          webhookEventId: eventId,
          type: 'PAYMENT_STATUS_CHANGED',
          statusVersion: { not: null },
        },
      }),
    };
  }
  async confirm(id: string, scenario: 'success' | 'decline') {
    if (this.provider.name !== 'fake' || !this.provider.confirmTestIntent)
      throw new ApiError('NOT_FOUND', 404, 'Endpoint not found.');
    const payment = await this.payment(id);
    if (
      !payment.stripePaymentIntentId ||
      payment.status === 'CANCELED' ||
      payment.providerStatus === 'processing' ||
      (payment.status === 'SUCCEEDED' && scenario !== 'success')
    )
      throw new ApiError(
        'PAYMENT_NOT_CONFIRMABLE',
        409,
        'Payment is not confirmable.',
      );
    // The same fenced lease serializes confirmations and observations. Release
    // before HTTP delivery so the normal webhook can acquire it independently.
    const claim = await this.leases.claim(id, 'sync');
    if (!claim)
      throw new ApiError(
        'OPERATION_IN_PROGRESS',
        409,
        'Payment is busy.',
        true,
      );
    let event: { id: string; raw: Buffer };
    try {
      event = this.provider.confirmTestIntent(
        payment.stripePaymentIntentId,
        scenario,
      );
    } catch {
      throw new ApiError(
        'PAYMENT_NOT_CONFIRMABLE',
        409,
        'Synthetic intent cannot accept this scenario.',
      );
    } finally {
      await localTransaction(this.db, (tx) => this.leases.release(tx, claim));
    }
    return {
      paymentId: id,
      eventId: event.id,
      deliveryStatus: await this.deliver(event.raw),
    };
  }
}
