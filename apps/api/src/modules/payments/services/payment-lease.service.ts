import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { Inject, Injectable } from '@nestjs/common';
import { Prisma, type Payment } from '../../../generated/prisma/client.js';
import { PAYMENT_PROVIDER } from '../../../integrations/payment-provider.token.js';
import type { PaymentProvider } from '../../../integrations/payment-provider.interface.js';
import type {
  ProviderCreateParams,
  VerifiedProviderEvent,
} from '../../../integrations/payment-provider.types.js';
import { ConfigService } from '../../../shared/config/config.service.js';
import { DatabaseService } from '../../../shared/database/database.service.js';
import {
  databaseTime,
  localTransaction,
} from '../../../shared/database/local-transaction.js';
import { ApiError } from '../../../shared/http/api-error.js';
import {
  createAllowed,
  frozenParams,
  history,
} from '../payment-provider-policy.js';
import type { LeaseClaim, SyncSource } from '../payment-sync.types.js';

export function operationBusy(
  source: SyncSource,
  until?: Date,
  now = new Date(),
) {
  const seconds = Math.max(
    1,
    Math.ceil(
      ((until?.getTime() ?? now.getTime() + 1000) - now.getTime()) / 1000,
    ),
  );
  return new ApiError(
    source === 'webhook' ? 'PROVIDER_UNAVAILABLE' : 'OPERATION_IN_PROGRESS',
    source === 'webhook' ? 503 : 409,
    'The operation is busy or waiting for its retry time.',
    true,
    null,
    seconds,
  );
}

@Injectable()
export class PaymentLeaseService {
  constructor(
    private readonly db: DatabaseService,
    private readonly config: ConfigService,
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
  ) {}

  async claim(
    id: string,
    source: SyncSource,
    event?: VerifiedProviderEvent,
  ): Promise<LeaseClaim | null> {
    const result = await localTransaction(this.db, async (tx) => {
      await tx.$queryRaw`SELECT id FROM payments WHERE id = ${id}::uuid FOR UPDATE`;
      const payment = await tx.payment.findUnique({ where: { id } });
      if (!payment)
        throw new ApiError('PAYMENT_NOT_FOUND', 404, 'Payment not found.');
      const now = await databaseTime(tx);
      if (event) {
        await tx.$queryRaw`SELECT id FROM webhook_events WHERE id = ${event.id} FOR UPDATE`;
        const receipt = await tx.webhookEvent.findUniqueOrThrow({
          where: { id: event.id },
        });
        if (
          ['PROCESSED', 'IGNORED', 'REVIEW_REQUIRED'].includes(receipt.status)
        )
          return null;
        if (receipt.nextRetryAt && receipt.nextRetryAt > now)
          throw operationBusy(source, receipt.nextRetryAt, now);
      }
      if (payment.leaseExpiresAt && payment.leaseExpiresAt > now)
        throw operationBusy(source, payment.leaseExpiresAt, now);
      if (
        source === 'confirmation_session' &&
        (['SUCCEEDED', 'CANCELED'].includes(payment.status) ||
          payment.provisioningStatus === 'REVIEW_REQUIRED')
      )
        throw new ApiError(
          payment.provisioningStatus === 'REVIEW_REQUIRED'
            ? 'REVIEW_REQUIRED'
            : 'PAYMENT_NOT_CONFIRMABLE',
          409,
          'Payment cannot obtain a confirmation session.',
        );
      if (source === 'sync' && !payment.stripePaymentIntentId)
        throw new ApiError(
          'PROVIDER_NOT_INITIALIZED',
          409,
          'No provider intent is linked.',
        );
      if (source !== 'webhook' && payment.provisioningStatus === 'BLOCKED')
        throw new ApiError(
          'PROVIDER_CONFIGURATION_ERROR',
          502,
          'Provider configuration requires operator review.',
        );
      const create = !payment.stripePaymentIntentId && !event;
      if (create && !createAllowed(payment, now)) {
        await tx.payment.update({
          where: { id },
          data: {
            provisioningStatus: 'REVIEW_REQUIRED',
            lastProviderErrorCode: 'CREATE_SAFETY_LIMIT',
            nextProviderRetryAt: null,
            leaseToken: null,
            leaseExpiresAt: null,
          },
        });
        await tx.paymentEvent.create({
          data: {
            paymentId: id,
            type: 'REVIEW_REQUIRED',
            details: { source, code: 'CREATE_SAFETY_LIMIT' },
          },
        });
        return new ApiError(
          'REVIEW_REQUIRED',
          409,
          'Provider creation protection exhausted. Investigate the original operation.',
        );
      }
      if (payment.nextProviderRetryAt && payment.nextProviderRetryAt > now)
        throw operationBusy(source, payment.nextProviderRetryAt, now);
      let params: ProviderCreateParams | null = null;
      if (create) {
        params =
          (payment.providerCreateParams as ProviderCreateParams | null) ??
          frozenParams(
            payment,
            this.provider,
            this.config.values.appInstanceId,
          );
        // Configuration changes cannot silently send an old operation to another account/version/environment.
        if (
          !isDeepStrictEqual(
            params,
            frozenParams(
              payment,
              this.provider,
              this.config.values.appInstanceId,
            ),
          )
        ) {
          await tx.payment.update({
            where: { id },
            data: {
              provisioningStatus: 'BLOCKED',
              lastProviderErrorCode: 'PROVIDER_CONFIGURATION_ERROR',
            },
          });
          await tx.paymentEvent.create({
            data: {
              paymentId: id,
              type: 'PROVIDER_BLOCKED',
              details: { source, code: 'PROVIDER_CONFIGURATION_ERROR' },
            },
          });
          return new ApiError(
            'PROVIDER_CONFIGURATION_ERROR',
            502,
            'Frozen operation no longer matches configured provider identity.',
          );
        }
      }
      const token = randomUUID();
      const claimed = await tx.payment.update({
        where: { id },
        data: {
          leaseToken: token,
          leaseExpiresAt: new Date(now.getTime() + 30000),
          ...(create
            ? {
                providerCreateParams: params as Prisma.InputJsonValue,
                firstProviderRequestAt: payment.firstProviderRequestAt ?? now,
                createAttemptCount: { increment: 1 },
              }
            : {}),
        },
      });
      if (event) {
        const receipt = await tx.webhookEvent.findUniqueOrThrow({
          where: { id: event.id },
        });
        await tx.webhookEvent.update({
          where: { id: event.id },
          data: {
            paymentId: id,
            processingAttempts: { increment: 1 },
            processingHistory: history(
              receipt.processingHistory,
              now,
              'STARTED',
            ),
          },
        });
      }
      return {
        payment: claimed,
        token,
        create,
        params,
        source,
        ...(event ? { event } : {}),
      };
    });
    if (result instanceof ApiError) throw result;
    return result;
  }

  async owned(
    tx: Prisma.TransactionClient,
    claim: LeaseClaim,
  ): Promise<Payment> {
    const rows = await tx.$queryRaw<
      { id: string }[]
    >`SELECT id FROM payments WHERE id = ${claim.payment.id}::uuid AND lease_token = ${claim.token}::uuid AND lease_expires_at > clock_timestamp() FOR UPDATE`;
    if (!rows.length) throw operationBusy(claim.source);
    if (claim.event)
      await tx.$queryRaw`SELECT id FROM webhook_events WHERE id = ${claim.event.id} FOR UPDATE`;
    return tx.payment.findUniqueOrThrow({ where: { id: claim.payment.id } });
  }
  async release(tx: Prisma.TransactionClient, claim: LeaseClaim) {
    const count =
      await tx.$executeRaw`UPDATE payments SET lease_token = NULL, lease_expires_at = NULL WHERE id = ${claim.payment.id}::uuid AND lease_token = ${claim.token}::uuid AND lease_expires_at > clock_timestamp()`;
    if (count !== 1) throw operationBusy(claim.source);
  }
}
