import { ApiProperty } from '@nestjs/swagger';
import { invalid } from '../../../shared/http/api-error.js';

export class CreatePaymentDto {
  @ApiProperty({
    type: 'integer',
    minimum: 100,
    maximum: 1000000,
    example: 2500,
  })
  amount!: number;

  @ApiProperty({
    type: String,
    description: 'USD or EUR, trimmed and case-insensitive.',
    example: 'USD',
  })
  currency!: 'USD' | 'EUR';

  static parse(value: unknown): CreatePaymentDto {
    if (!value || typeof value !== 'object' || Array.isArray(value))
      invalid('body', 'Expected a JSON object.');
    const body = value as Record<string, unknown>;
    if (Object.keys(body).some((key) => !['amount', 'currency'].includes(key)))
      invalid('body', 'Unknown fields are not accepted.');
    if (
      typeof body.amount !== 'number' ||
      !Number.isInteger(body.amount) ||
      body.amount < 100 ||
      body.amount > 1000000
    )
      invalid(
        'amount',
        'Expected an integer from 100 through 1000000 minor units.',
      );
    if (typeof body.currency !== 'string')
      invalid('currency', 'Expected USD or EUR.');
    const currency = body.currency.trim().toUpperCase();
    if (currency !== 'USD' && currency !== 'EUR')
      invalid('currency', 'Expected USD or EUR.');
    return { amount: body.amount, currency };
  }
}
