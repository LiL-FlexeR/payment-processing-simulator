import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import {
  ApiBody,
  ApiCreatedResponse,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { PaymentStatus } from '../../generated/prisma/client.js';
import { ErrorDto } from '../../shared/http/error.dto.js';
import { CreatePaymentDto } from './dto/create-payment.dto.js';
import {
  ListPaymentsQueryDto,
  ListPaymentEventsQueryDto,
} from './dto/payment-query.dto.js';
import {
  CreationRepresentationDto,
  PaymentDetailsDto,
  PaymentEventListDto,
  PaymentListDto,
} from './dto/payment-response.dto.js';
import {
  idempotencyKey,
  noBody,
  paymentId,
  queryFields,
} from './payment-validation.js';
import { PaymentsService } from './services/payments.service.js';
import { PaymentSyncService } from './services/payment-sync.service.js';
import {
  ConfirmationSessionDto,
  EmptyPaymentOperationDto,
} from './dto/confirmation-session.dto.js';
import { invalid } from '../../shared/http/api-error.js';

@ApiTags('payments')
@ApiHeader({
  name: 'X-Request-Id',
  required: false,
  schema: { type: 'string', format: 'uuid' },
})
@ApiResponse({ status: 400, type: ErrorDto })
@ApiResponse({ status: 413, type: ErrorDto })
@ApiResponse({ status: 415, type: ErrorDto })
@ApiResponse({ status: 500, type: ErrorDto })
@ApiResponse({
  status: 503,
  type: ErrorDto,
  headers: { 'Retry-After': { schema: { type: 'integer', minimum: 1 } } },
})
@Controller('payments')
export class PaymentsController {
  constructor(
    private readonly payments: PaymentsService,
    private readonly synchronization: PaymentSyncService,
  ) {}

  private operation(request: Request, id: string, body: unknown) {
    queryFields(request.query, []);
    if (
      body === null ||
      typeof body !== 'object' ||
      Array.isArray(body) ||
      Object.keys(body).length
    )
      invalid('body', 'Expected exactly an empty JSON object.');
    return paymentId(id);
  }

  @Post(':id/confirmation-session')
  @HttpCode(200)
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiBody({ type: EmptyPaymentOperationDto })
  @ApiOkResponse({ type: ConfirmationSessionDto })
  @ApiResponse({ status: 404, type: ErrorDto })
  @ApiResponse({ status: 409, type: ErrorDto })
  @ApiResponse({ status: 502, type: ErrorDto })
  @ApiOperation({
    summary:
      'Create/recover one intent; release its secret only after validated linkage commits.',
  })
  confirmationSession(
    @Req() request: Request,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.synchronization.confirmationSession(
      this.operation(request, id, body),
    );
  }

  @Post(':id/sync')
  @HttpCode(200)
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiBody({ type: EmptyPaymentOperationDto })
  @ApiOkResponse({ type: PaymentDetailsDto })
  @ApiResponse({ status: 404, type: ErrorDto })
  @ApiResponse({ status: 409, type: ErrorDto })
  @ApiResponse({ status: 502, type: ErrorDto })
  @ApiOperation({
    summary:
      'Retrieve a known intent and synchronize the local projection without confirming or creating.',
  })
  sync(
    @Req() request: Request,
    @Param('id') id: string,
    @Body() body: unknown,
  ) {
    return this.synchronization.sync(this.operation(request, id, body));
  }

  @Post()
  @ApiOperation({
    summary:
      'Create a local payment; no provider call. Identical retries replay the frozen 201 body.',
  })
  @ApiHeader({
    name: 'Idempotency-Key',
    required: true,
    schema: {
      type: 'string',
      minLength: 16,
      maxLength: 128,
      pattern: '^[A-Za-z0-9._:-]+$',
    },
  })
  @ApiBody({ type: CreatePaymentDto })
  @ApiCreatedResponse({
    type: CreationRepresentationDto,
    headers: {
      Location: {
        schema: { type: 'string' },
        description: '/api/v1/payments/<id>',
      },
      'Idempotency-Replayed': {
        schema: { type: 'string', enum: ['false', 'true'] },
      },
    },
  })
  @ApiResponse({ status: 409, type: ErrorDto })
  @ApiResponse({
    status: 429,
    type: ErrorDto,
    headers: { 'Retry-After': { schema: { type: 'integer', minimum: 1 } } },
  })
  async create(
    @Req() request: Request,
    @Body() body: unknown,
    @Res({ passthrough: true }) response: Response,
  ) {
    queryFields(request.query, []);
    const key = idempotencyKey(request);
    const result = await this.payments.create(
      key,
      CreatePaymentDto.parse(body),
    );
    response.setHeader('Location', `/api/v1/payments/${result.body.id}`);
    response.setHeader('Idempotency-Replayed', String(result.replayed));
    return result.body;
  }

  @Get()
  @ApiQuery({ name: 'status', required: false, enum: PaymentStatus })
  @ApiQuery({
    name: 'limit',
    required: false,
    schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
  })
  @ApiQuery({
    name: 'cursor',
    required: false,
    schema: { type: 'string', maxLength: 1024 },
    description:
      'Base64url JSON of the last createdAt/id tuple and active status filter.',
  })
  @ApiOkResponse({ type: PaymentListDto })
  list(@Req() request: Request, @Query() query: Record<string, unknown>) {
    noBody(request);
    return this.payments.list(ListPaymentsQueryDto.parse(query));
  }

  @Get(':id')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: PaymentDetailsDto })
  @ApiResponse({ status: 404, type: ErrorDto })
  details(@Req() request: Request, @Param('id') id: string) {
    noBody(request);
    queryFields(request.query, []);
    return this.payments.details(paymentId(id));
  }

  @Get(':id/events')
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiQuery({
    name: 'limit',
    required: false,
    schema: { type: 'integer', minimum: 1, maximum: 100, default: 50 },
  })
  @ApiQuery({
    name: 'cursor',
    required: false,
    schema: { type: 'string', maxLength: 1024 },
    description:
      'Base64url JSON containing the last positive bigint event ID as a string.',
  })
  @ApiOkResponse({ type: PaymentEventListDto })
  @ApiResponse({ status: 404, type: ErrorDto })
  events(
    @Req() request: Request,
    @Param('id') id: string,
    @Query() query: Record<string, unknown>,
  ) {
    noBody(request);
    return this.payments.events(
      paymentId(id),
      ListPaymentEventsQueryDto.parse(query),
    );
  }
}
