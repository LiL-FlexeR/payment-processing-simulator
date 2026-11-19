import { Controller, HttpCode, Post, Req } from '@nestjs/common';
import {
  ApiBody,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { ApiError } from '../../shared/http/api-error.js';
import { ErrorDto } from '../../shared/http/error.dto.js';
import { queryFields } from '../payments/payment-validation.js';
import { WebhooksService } from './webhooks.service.js';

@ApiTags('webhooks')
@Controller('webhooks')
export class WebhooksController {
  constructor(private readonly webhooks: WebhooksService) {}
  @Post('stripe')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Verify exact signed snapshot bytes; acknowledge only a durable final disposition.',
  })
  @ApiHeader({ name: 'Stripe-Signature', required: true })
  @ApiBody({
    schema: {
      type: 'object',
      additionalProperties: true,
      description:
        'Complete signed snapshot event at the pinned API version; maximum 256 KiB.',
    },
  })
  @ApiOkResponse({
    schema: {
      type: 'object',
      required: ['received'],
      properties: { received: { type: 'boolean', enum: [true] } },
    },
  })
  @ApiResponse({ status: 400, type: ErrorDto })
  @ApiResponse({ status: 413, type: ErrorDto })
  @ApiResponse({ status: 415, type: ErrorDto })
  @ApiResponse({ status: 500, type: ErrorDto })
  @ApiResponse({ status: 503, type: ErrorDto })
  receive(@Req() request: Request) {
    queryFields(request.query, []);
    const signature = request.headers['stripe-signature'];
    if (!Buffer.isBuffer(request.body) || typeof signature !== 'string')
      throw new ApiError(
        'INVALID_WEBHOOK',
        400,
        'A signed raw webhook is required.',
      );
    return this.webhooks.receive(request.body, signature);
  }
}
