import { ApiProperty } from '@nestjs/swagger';
import {
  PaymentStatus,
  ProvisioningStatus,
  PaymentEventType,
} from '../../../generated/prisma/client.js';
import type {
  Payment,
  PaymentEvent,
  Prisma,
} from '../../../generated/prisma/client.js';

class PaymentIdentityDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ type: 'integer', minimum: 100, maximum: 1000000 })
  amount!: number;
  @ApiProperty({ enum: ['USD', 'EUR'] }) currency!: string;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
}

export class CreationRepresentationDto extends PaymentIdentityDto {
  @ApiProperty({ enum: ['CREATED'] }) status!: 'CREATED';

  static fromPayment(payment: Payment): CreationRepresentationDto {
    return {
      id: payment.id,
      amount: payment.amount,
      currency: payment.currency,
      status: 'CREATED',
      createdAt: payment.createdAt.toISOString(),
    };
  }

  static fromSnapshot(value: Prisma.JsonValue): CreationRepresentationDto {
    const snapshot = value as unknown as CreationRepresentationDto;
    return {
      id: snapshot.id,
      amount: snapshot.amount,
      currency: snapshot.currency,
      status: snapshot.status,
      createdAt: snapshot.createdAt,
    };
  }
}

export class PaymentSummaryDto extends PaymentIdentityDto {
  @ApiProperty({ enum: PaymentStatus }) status!: PaymentStatus;
  @ApiProperty({ format: 'date-time' }) updatedAt!: string;
  @ApiProperty({ type: 'integer', minimum: 1 }) statusVersion!: number;
  @ApiProperty({ enum: ProvisioningStatus })
  provisioningStatus!: ProvisioningStatus;

  static fromPayment(payment: Payment): PaymentSummaryDto {
    return {
      id: payment.id,
      amount: payment.amount,
      currency: payment.currency,
      status: payment.status,
      createdAt: payment.createdAt.toISOString(),
      updatedAt: payment.updatedAt.toISOString(),
      statusVersion: payment.statusVersion,
      provisioningStatus: payment.provisioningStatus,
    };
  }
}

export class PaymentDetailsDto extends PaymentSummaryDto {
  @ApiProperty({ type: String, nullable: true }) stripePaymentIntentId!:
    string | null;
  @ApiProperty({ type: String, nullable: true }) providerStatus!: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  lastSyncedAt!: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  nextProviderRetryAt!: string | null;
  @ApiProperty({ type: String, nullable: true }) lastProviderErrorCode!:
    string | null;

  static fromPayment(payment: Payment): PaymentDetailsDto {
    return {
      ...PaymentSummaryDto.fromPayment(payment),
      stripePaymentIntentId: null,
      providerStatus: null,
      lastSyncedAt: null,
      nextProviderRetryAt: null,
      lastProviderErrorCode: null,
    };
  }
}

export class PaymentEventDto {
  @ApiProperty({ type: String, pattern: '^[1-9][0-9]*$', example: '1' })
  id!: string;
  @ApiProperty({ format: 'uuid' }) paymentId!: string;
  @ApiProperty({ enum: PaymentEventType }) type!: PaymentEventType;
  @ApiProperty({ enum: PaymentStatus, nullable: true })
  fromStatus!: PaymentStatus | null;
  @ApiProperty({ enum: PaymentStatus, nullable: true })
  toStatus!: PaymentStatus | null;
  @ApiProperty({ type: 'integer', nullable: true, minimum: 1 }) statusVersion!:
    number | null;
  @ApiProperty({ type: String, nullable: true }) webhookEventId!: string | null;
  @ApiProperty({
    type: 'object',
    additionalProperties: { type: 'string' },
    example: { source: 'api' },
  })
  details!: Record<string, string>;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;

  static fromEvent(event: PaymentEvent): PaymentEventDto {
    const details: Record<string, string> = {};
    if (
      event.details &&
      typeof event.details === 'object' &&
      !Array.isArray(event.details)
    ) {
      for (const key of [
        'source',
        'code',
        'providerStatus',
        'providerRequestId',
      ]) {
        const value = event.details[key];
        if (typeof value === 'string') details[key] = value;
      }
    }
    return {
      id: event.id.toString(),
      paymentId: event.paymentId,
      type: event.type,
      fromStatus: event.fromStatus,
      toStatus: event.toStatus,
      statusVersion: event.statusVersion,
      webhookEventId: null,
      details,
      createdAt: event.createdAt.toISOString(),
    };
  }
}

export class PaymentListDto {
  @ApiProperty({ type: [PaymentSummaryDto] }) items!: PaymentSummaryDto[];
  @ApiProperty({ type: String, nullable: true }) nextCursor!: string | null;
}

export class PaymentEventListDto {
  @ApiProperty({ type: [PaymentEventDto] }) items!: PaymentEventDto[];
  @ApiProperty({ type: String, nullable: true }) nextCursor!: string | null;
}
