import { Inject, Injectable, Logger } from '@nestjs/common';
import type { WebhookEvent } from '../../generated/prisma/client.js';
import { PAYMENT_PROVIDER } from '../../integrations/payment-provider.token.js';
import type { PaymentProvider } from '../../integrations/payment-provider.interface.js';
import {
  InvalidProviderWebhook,
  type VerifiedProviderEvent,
} from '../../integrations/payment-provider.types.js';
import { ConfigService } from '../../shared/config/config.service.js';
import { DatabaseService } from '../../shared/database/database.service.js';
import {
  databaseTime,
  localTransaction,
} from '../../shared/database/local-transaction.js';
import { ApiError } from '../../shared/http/api-error.js';
import { history, retryDelay } from '../payments/payment-provider-policy.js';
import { PaymentSyncService } from '../payments/services/payment-sync.service.js';
import { operationBusy } from '../payments/services/payment-lease.service.js';

const disposed = (receipt: WebhookEvent) =>
  ['PROCESSED', 'IGNORED', 'REVIEW_REQUIRED'].includes(receipt.status);

@Injectable()
export class WebhooksService {
  private readonly logger = new Logger('Webhooks');
  constructor(
    private readonly db: DatabaseService,
    private readonly config: ConfigService,
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
    private readonly sync: PaymentSyncService,
  ) {}

  async receive(raw: Buffer, signature: string) {
    let event: VerifiedProviderEvent;
    try {
      event = this.provider.verifyEvent(raw, signature);
    } catch (error) {
      if (!(error instanceof InvalidProviderWebhook)) throw error;
      throw new ApiError(
        'INVALID_WEBHOOK',
        400,
        'Invalid webhook signature or envelope.',
      );
    }
    const receipt = await this.record(event);
    if (disposed(receipt)) return { received: true };
    if (
      !event.supported ||
      event.metadataInstanceId !== this.config.values.appInstanceId
    ) {
      await localTransaction(this.db, async (tx) => {
        await tx.$queryRaw`SELECT id FROM webhook_events WHERE id = ${event.id} FOR UPDATE`;
        const current = await tx.webhookEvent.findUniqueOrThrow({
          where: { id: event.id },
        });
        if (disposed(current)) return;
        const now = await databaseTime(tx);
        await tx.webhookEvent.update({
          where: { id: event.id },
          data: {
            status: 'IGNORED',
            processedAt: now,
            nextRetryAt: null,
            lastErrorCode: event.supported
              ? 'FOREIGN_INSTANCE'
              : 'UNSUPPORTED_EVENT',
            processingHistory: history(
              current.processingHistory,
              now,
              'IGNORED',
              event.supported ? 'FOREIGN_INSTANCE' : 'UNSUPPORTED_EVENT',
            ),
          },
        });
      });
      return { received: true };
    }
    const payment =
      (await this.db.payment.findUnique({
        where: { stripePaymentIntentId: event.providerObjectId! },
      })) ??
      (await this.db.payment.findUnique({
        where: { id: event.metadataPaymentId! },
      }));
    if (!payment) {
      const review = await this.unresolved(event);
      if (review) return { received: true };
      throw new ApiError(
        'PROVIDER_UNAVAILABLE',
        503,
        'Webhook payment correlation is awaiting recovery.',
        true,
      );
    }
    try {
      await this.sync.webhook(payment.id, event);
    } catch (error) {
      // T4 rollback must leave the receipt processable. Even failure-recording can
      // fail during an outage; lease expiry and redelivery retain recovery.
      this.logger.warn(
        JSON.stringify({
          event: 'webhook_unfinished',
          paymentId: payment.id,
          webhookEventId: event.id,
          code: 'WEBHOOK_PROCESSING_FAILED',
        }),
      );
      if (error instanceof ApiError && error.getStatus() === 503) throw error;
      throw new ApiError(
        'PROVIDER_UNAVAILABLE',
        503,
        'Webhook processing is unfinished. Redeliver this event.',
        true,
      );
    }
    return { received: true };
  }

  private async record(event: VerifiedProviderEvent) {
    return localTransaction(this.db, async (tx) => {
      // ON CONFLICT waits for the first insert, then locks the committed receipt.
      const inserted =
        await tx.$executeRaw`INSERT INTO webhook_events (id,type,api_version,provider_created_at,livemode,provider_object_id,metadata_payment_id,metadata_instance_id,metadata_operation_key)
        VALUES (${event.id},${event.type},${event.apiVersion},${event.providerCreatedAt},false,${event.providerObjectId},${event.metadataPaymentId},${event.metadataInstanceId},${event.metadataOperationKey}) ON CONFLICT (id) DO NOTHING`;
      await tx.$queryRaw`SELECT id FROM webhook_events WHERE id = ${event.id} FOR UPDATE`;
      const current = await tx.webhookEvent.findUniqueOrThrow({
        where: { id: event.id },
      });
      if (
        current.type !== event.type ||
        current.apiVersion !== event.apiVersion ||
        current.providerCreatedAt.getTime() !==
          event.providerCreatedAt.getTime() ||
        current.livemode !== event.livemode ||
        current.providerObjectId !== event.providerObjectId ||
        current.metadataPaymentId !== event.metadataPaymentId ||
        current.metadataInstanceId !== event.metadataInstanceId ||
        current.metadataOperationKey !== event.metadataOperationKey
      ) {
        this.logger.warn(
          JSON.stringify({
            event: 'webhook_identity_conflict',
            webhookEventId: event.id,
            code: 'INVALID_WEBHOOK',
          }),
        );
        throw new ApiError(
          'INVALID_WEBHOOK',
          400,
          'Webhook identity conflicts with the stored receipt.',
        );
      }
      const now = await databaseTime(tx);
      return tx.webhookEvent.update({
        where: { id: event.id },
        data: {
          lastReceivedAt: now,
          ...(inserted === 0 ? { deliveryCount: { increment: 1 } } : {}),
        },
      });
    });
  }
  private async unresolved(event: VerifiedProviderEvent) {
    return localTransaction(this.db, async (tx) => {
      await tx.$queryRaw`SELECT id FROM webhook_events WHERE id = ${event.id} FOR UPDATE`;
      const receipt = await tx.webhookEvent.findUniqueOrThrow({
        where: { id: event.id },
      });
      if (disposed(receipt)) return true;
      const now = await databaseTime(tx);
      if (receipt.nextRetryAt && receipt.nextRetryAt > now)
        throw operationBusy('webhook', receipt.nextRetryAt, now);
      const attempts = receipt.processingAttempts + 1;
      const review = attempts >= 10;
      const started = history(receipt.processingHistory, now, 'STARTED');
      await tx.webhookEvent.update({
        where: { id: event.id },
        data: {
          processingAttempts: attempts,
          status: review ? 'REVIEW_REQUIRED' : 'RETRYABLE',
          lastErrorCode: 'PAYMENT_CORRELATION_MISSING',
          nextRetryAt: review
            ? null
            : new Date(now.getTime() + retryDelay(attempts)),
          processingHistory: history(
            started,
            now,
            review ? 'REVIEW_REQUIRED' : 'RETRYABLE',
            'PAYMENT_CORRELATION_MISSING',
          ),
        },
      });
      this.logger.warn(
        JSON.stringify({
          event: 'webhook_correlation_missing',
          webhookEventId: event.id,
          code: review ? 'REVIEW_REQUIRED' : 'PAYMENT_CORRELATION_MISSING',
        }),
      );
      return review;
    });
  }
}
