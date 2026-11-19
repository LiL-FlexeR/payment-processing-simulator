import { ApiProperty } from '@nestjs/swagger';

export class EmptyPaymentOperationDto {}
export class ConfirmationSessionDto {
  @ApiProperty({ format: 'uuid' }) paymentId!: string;
  @ApiProperty({ enum: ['stripe', 'fake'] }) provider!: 'stripe' | 'fake';
  @ApiProperty({
    description: 'Sensitive transient value. Never cache, store or log.',
  })
  clientSecret!: string;
  @ApiProperty() publishableKey!: string;
  @ApiProperty() providerStatus!: string;
}
