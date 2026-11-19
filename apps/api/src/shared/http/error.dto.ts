import { ApiProperty } from '@nestjs/swagger';

class ValidationDetailDto {
  @ApiProperty() field!: string;
  @ApiProperty() message!: string;
}

class ErrorDetailsDto {
  @ApiProperty({
    enum: [
      'VALIDATION_ERROR',
      'PAYMENT_NOT_FOUND',
      'NOT_FOUND',
      'IDEMPOTENCY_KEY_REUSED',
      'DATABASE_UNAVAILABLE',
      'INTERNAL_ERROR',
      'UNSUPPORTED_MEDIA_TYPE',
      'PAYLOAD_TOO_LARGE',
      'RATE_LIMITED',
    ],
  })
  code!: string;
  @ApiProperty() message!: string;
  @ApiProperty({ format: 'uuid' }) requestId!: string;
  @ApiProperty() retryable!: boolean;
  @ApiProperty({ type: [ValidationDetailDto], nullable: true }) details!:
    ValidationDetailDto[] | null;
}

export class ErrorDto {
  @ApiProperty({ type: ErrorDetailsDto }) error!: ErrorDetailsDto;
}
