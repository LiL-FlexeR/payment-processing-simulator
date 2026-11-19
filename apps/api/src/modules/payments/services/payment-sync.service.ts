import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '../../../generated/prisma/client.js';
import { PAYMENT_PROVIDER } from '../../../integrations/payment-provider.token.js';
import type { PaymentProvider } from '../../../integrations/payment-provider.interface.js';
import {
  ProviderFailure,
  type ProviderObservation,
  type VerifiedProviderEvent,
} from '../../../integrations/payment-provider.types.js';
import { ConfigService } from '../../../shared/config/config.service.js';
import { DatabaseService } from '../../../shared/database/database.service.js';
import { isProviderLinkConflict } from '../../../shared/database/database-errors.js';
import {
  databaseTime,
  localTransaction,
} from '../../../shared/database/local-transaction.js';
import { ApiError } from '../../../shared/http/api-error.js';
import { PaymentDetailsDto } from '../dto/payment-response.dto.js';
import {
  InvalidPaymentTransition,
  projectObservation,
} from '../payment-state-machine.js';
import {
  createAllowed,
  history,
  retryDelay,
  validObservation,
} from '../payment-provider-policy.js';
import type { LeaseClaim, SyncSource } from '../payment-sync.types.js';
import { PaymentLeaseService } from './payment-lease.service.js';
import { PaymentStatusService } from './payment-status.service.js';

@Injectable()
export class PaymentSyncService {
  private readonly logger = new Logger('PaymentSync');
  constructor(
    private readonly db: DatabaseService,
    private readonly config: ConfigService,
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
    private readonly leases: PaymentLeaseService,
    private readonly statuses: PaymentStatusService,
  ) {}

  async confirmationSession(id: string) {
    const result = await this.run(id, 'confirmation_session');
    if (
      !result ||
      ['SUCCEEDED', 'CANCELED'].includes(result.payment.status) ||
      result.observation.phase === 'PROCESSING'
    )
      throw new ApiError(
        'PAYMENT_NOT_CONFIRMABLE',
        409,
        'Payment is terminal or currently processing.',
      );
    if (!result.observation.clientSecret)
      throw new ApiError(
        'PAYMENT_NOT_CONFIRMABLE',
        409,
        'No confirmation session is available.',
      );
    return {
      paymentId: id,
      provider: this.provider.name,
      clientSecret: result.observation.clientSecret,
      publishableKey: this.provider.publishableKey,
      providerStatus: result.observation.providerStatus,
    };
  }
  async sync(id: string) {
    const result = await this.run(id, 'sync');
    return PaymentDetailsDto.fromPayment(result!.payment);
  }
  async webhook(id: string, event: VerifiedProviderEvent) {
    await this.run(id, 'webhook', event);
  }

  private async run(
    id: string,
    source: SyncSource,
    event?: VerifiedProviderEvent,
  ) {
    const claim = await this.leases.claim(id, source, event);
    if (!claim) return null;
    let observation: ProviderObservation;
    try {
      // T3 has committed; no transaction or row lock spans this bounded HTTP call.
      observation = claim.create
        ? await this.provider.createIntent(
            claim.params!,
            claim.payment.providerOperationKey,
          )
        : await this.provider.retrieveIntent(
            event?.providerObjectId ?? claim.payment.stripePaymentIntentId!,
          );
    } catch (error) {
      const failure =
        error instanceof ProviderFailure
          ? error
          : new ProviderFailure('transient', 'PROVIDER_UNAVAILABLE');
      const result = await this.fail(claim, failure);
      if (source === 'webhook' && result.disposition !== 'RETRYABLE')
        return null;
      throw this.failureResponse(
        claim,
        result.disposition,
        result.retryAfterSeconds,
      );
    }
    const applied = await localTransaction(this.db, async (tx) => {
      const payment = await this.leases.owned(tx, claim);
      let code: string | null = null;
      const linked = await tx.payment.findUnique({
        where: { stripePaymentIntentId: observation.id },
      });
      if (
        (linked && linked.id !== payment.id) ||
        !validObservation(
          payment,
          observation,
          this.provider,
          this.config.values.appInstanceId,
        ) ||
        (event &&
          (event.providerObjectId !== observation.id ||
            event.metadataPaymentId !== payment.id ||
            event.metadataInstanceId !== this.config.values.appInstanceId ||
            event.metadataOperationKey !== payment.providerOperationKey))
      )
        code = 'PROVIDER_IDENTITY_MISMATCH';
      else {
        try {
          projectObservation(payment.status, {
            phase: observation.phase,
            source,
          });
        } catch (error) {
          if (!(error instanceof InvalidPaymentTransition)) throw error;
          code = 'PROVIDER_STATE_CONFLICT';
        }
      }
      const now = await databaseTime(tx);
      if (code) {
        await this.review(tx, claim, code, now, observation.requestId);
        await this.leases.release(tx, claim);
        return { review: true as const, payment };
      }
      const details = {
        providerStatus: observation.providerStatus,
        ...(observation.requestId
          ? { providerRequestId: observation.requestId }
          : {}),
        ...(observation.paymentErrorCode
          ? { code: observation.paymentErrorCode }
          : {}),
      };
      const previousVersion = payment.statusVersion;
      let updated = await this.statuses.apply(
        tx,
        id,
        { phase: observation.phase, source },
        { ...(event ? { webhookEventId: event.id } : {}), details },
      );
      updated = await tx.payment.update({
        where: { id },
        data: {
          stripePaymentIntentId: observation.id,
          providerStatus: observation.providerStatus,
          provisioningStatus: 'READY',
          nextProviderRetryAt: null,
          lastProviderErrorCode: observation.paymentErrorCode,
          lastSyncedAt: now,
        },
      });
      const changed = updated.statusVersion !== previousVersion;
      if (!changed && source === 'sync')
        await tx.paymentEvent.create({
          data: {
            paymentId: id,
            type: 'SYNC_NO_CHANGE',
            details: { source, ...details },
          },
        });
      if (event) {
        const receipt = await tx.webhookEvent.findUniqueOrThrow({
          where: { id: event.id },
        });
        await tx.webhookEvent.update({
          where: { id: event.id },
          data: {
            status: 'PROCESSED',
            processedAt: now,
            nextRetryAt: null,
            lastErrorCode: null,
            processingHistory: history(
              receipt.processingHistory,
              now,
              changed ? 'PROCESSED' : 'NO_CHANGE',
            ),
          },
        });
      }
      await this.leases.release(tx, claim);
      return { review: false as const, payment: updated };
    }).catch(async (error) => {
      if (isProviderLinkConflict(error)) {
        await this.fail(
          claim,
          new ProviderFailure(
            'review',
            'PROVIDER_IDENTITY_MISMATCH',
            observation.requestId,
          ),
        );
        return { review: true as const, payment: claim.payment };
      }
      // A failed apply rolls everything back. Record the failed attempt only in a
      // new fenced transaction, without repeating the external call.
      try {
        await this.fail(
          claim,
          new ProviderFailure(
            'transient',
            'WEBHOOK_PROCESSING_FAILED',
            observation.requestId,
          ),
        );
      } catch {
        /* Storage failure or lost ownership: leave recovery to expiry. */
      }
      throw error;
    });
    this.log(
      claim,
      observation.requestId,
      applied.review ? 'REVIEW_REQUIRED' : 'OBSERVATION_COMMITTED',
    );
    if (applied.review) {
      if (source === 'webhook') return null;
      throw new ApiError(
        'REVIEW_REQUIRED',
        409,
        'Provider observation requires operator review.',
      );
    }
    return { payment: applied.payment, observation };
  }

  private async review(
    tx: Prisma.TransactionClient,
    claim: LeaseClaim,
    code: string,
    now: Date,
    requestId: string | null,
  ) {
    await tx.payment.update({
      where: { id: claim.payment.id },
      data: {
        provisioningStatus: 'REVIEW_REQUIRED',
        lastProviderErrorCode: code,
        nextProviderRetryAt: null,
      },
    });
    await tx.paymentEvent.create({
      data: {
        paymentId: claim.payment.id,
        webhookEventId: claim.event?.id,
        type: 'REVIEW_REQUIRED',
        details: {
          source: claim.source,
          code,
          ...(requestId ? { providerRequestId: requestId } : {}),
        },
      },
    });
    if (claim.event) {
      const receipt = await tx.webhookEvent.findUniqueOrThrow({
        where: { id: claim.event.id },
      });
      await tx.webhookEvent.update({
        where: { id: claim.event.id },
        data: {
          status: 'REVIEW_REQUIRED',
          lastErrorCode: code,
          nextRetryAt: null,
          processingHistory: history(
            receipt.processingHistory,
            now,
            'REVIEW_REQUIRED',
            code,
          ),
        },
      });
    }
  }
  private async fail(claim: LeaseClaim, failure: ProviderFailure) {
    const disposition = await localTransaction(this.db, async (tx) => {
      const payment = await this.leases.owned(tx, claim);
      const now = await databaseTime(tx);
      if (
        failure.kind === 'review' ||
        (failure.kind === 'transient' &&
          claim.create &&
          !createAllowed(payment, now))
      ) {
        await this.review(
          tx,
          claim,
          failure.kind === 'review' ? failure.code : 'CREATE_SAFETY_LIMIT',
          now,
          failure.requestId,
        );
        await this.leases.release(tx, claim);
        return {
          disposition: 'REVIEW_REQUIRED' as const,
          retryAfterSeconds: 0,
        };
      }
      const blocked = failure.kind === 'blocked';
      const attempts = claim.event
        ? (
            await tx.webhookEvent.findUniqueOrThrow({
              where: { id: claim.event.id },
            })
          ).processingAttempts
        : Math.max(1, payment.createAttemptCount);
      const retryAt = blocked
        ? null
        : new Date(now.getTime() + retryDelay(attempts, failure.retryAfterMs));
      await tx.payment.update({
        where: { id: payment.id },
        data: {
          provisioningStatus: blocked ? 'BLOCKED' : 'RETRYABLE',
          nextProviderRetryAt: retryAt,
          lastProviderErrorCode: failure.code,
        },
      });
      await tx.paymentEvent.create({
        data: {
          paymentId: payment.id,
          webhookEventId: claim.event?.id,
          type: blocked ? 'PROVIDER_BLOCKED' : 'PROVIDER_RETRY_SCHEDULED',
          details: {
            source: claim.source,
            code: failure.code,
            ...(failure.requestId
              ? { providerRequestId: failure.requestId }
              : {}),
          },
        },
      });
      if (claim.event) {
        const receipt = await tx.webhookEvent.findUniqueOrThrow({
          where: { id: claim.event.id },
        });
        await tx.webhookEvent.update({
          where: { id: claim.event.id },
          data: {
            status: blocked ? 'REVIEW_REQUIRED' : 'RETRYABLE',
            nextRetryAt: retryAt,
            lastErrorCode: failure.code,
            processingHistory: history(
              receipt.processingHistory,
              now,
              blocked ? 'REVIEW_REQUIRED' : 'RETRYABLE',
              failure.code,
            ),
          },
        });
        await tx.paymentEvent.create({
          data: {
            paymentId: payment.id,
            webhookEventId: claim.event.id,
            type: 'WEBHOOK_PROCESSING_FAILED',
            details: { source: claim.source, code: failure.code },
          },
        });
      }
      await this.leases.release(tx, claim);
      return {
        disposition: blocked ? ('BLOCKED' as const) : ('RETRYABLE' as const),
        retryAfterSeconds: retryAt
          ? Math.max(1, Math.ceil((retryAt.getTime() - now.getTime()) / 1000))
          : 0,
      };
    });
    this.log(claim, failure.requestId, failure.code);
    return disposition;
  }
  private failureResponse(
    claim: LeaseClaim,
    disposition: string,
    retryAfterSeconds: number,
  ) {
    if (disposition === 'REVIEW_REQUIRED')
      return new ApiError(
        'REVIEW_REQUIRED',
        409,
        'Provider creation requires manual review.',
      );
    if (disposition === 'BLOCKED')
      return new ApiError(
        'PROVIDER_CONFIGURATION_ERROR',
        502,
        'Provider configuration requires operator review.',
      );
    return new ApiError(
      claim.create ? 'PROVIDER_OUTCOME_UNKNOWN' : 'PROVIDER_UNAVAILABLE',
      503,
      'Provider outcome is temporarily unavailable. Retry the same operation after backoff.',
      true,
      null,
      retryAfterSeconds,
    );
  }
  private log(claim: LeaseClaim, requestId: string | null, code: string) {
    this.logger.log(
      JSON.stringify({
        event: 'provider_operation',
        paymentId: claim.payment.id,
        ...(claim.event ? { webhookEventId: claim.event.id } : {}),
        ...(requestId ? { providerRequestId: requestId } : {}),
        source: claim.source,
        code,
      }),
    );
  }
}
