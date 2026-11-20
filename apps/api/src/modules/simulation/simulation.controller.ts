import {
  Body,
  Controller,
  HttpCode,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { invalid } from '../../shared/http/api-error.js';
import { paymentId, queryFields } from '../payments/payment-validation.js';
import { CreatePaymentDto } from '../payments/dto/create-payment.dto.js';
import { SimulationGuard } from './simulation.guard.js';
import { SimulationService } from './services/simulation.service.js';

function object(request: Request, value: unknown, fields: string[]) {
  queryFields(request.query, []);
  if (!value || typeof value !== 'object' || Array.isArray(value))
    invalid('body', 'Expected a JSON object.');
  const body = value as Record<string, unknown>;
  if (
    Object.keys(body).length !== fields.length ||
    Object.keys(body).some((key) => !fields.includes(key))
  )
    invalid('body', 'Unexpected or missing fields.');
  return body;
}
@ApiTags('development simulations')
@ApiBearerAuth()
@UseGuards(SimulationGuard)
@Controller('dev/simulations')
export class SimulationController {
  constructor(private readonly simulation: SimulationService) {}
  @Post('request-race')
  @HttpCode(200)
  race(@Req() req: Request, @Body() value: unknown) {
    const body = object(req, value, ['scenario', 'amount', 'currency']);
    if (
      body.scenario !== 'duplicate_request' &&
      body.scenario !== 'concurrent_requests'
    )
      invalid('scenario', 'Choose duplicate_request or concurrent_requests.');
    return this.simulation.race(
      body.scenario,
      CreatePaymentDto.parse({ amount: body.amount, currency: body.currency }),
    );
  }
  @Post('payments/:id/fault')
  @HttpCode(200)
  fault(@Req() req: Request, @Param('id') id: string, @Body() value: unknown) {
    const body = object(req, value, ['point']);
    if (
      body.point !== 'webhook_before_commit' &&
      body.point !== 'provider_response_timeout'
    )
      invalid('point', 'Choose a supported fault point.');
    return this.simulation.arm(paymentId(id), body.point);
  }
  @Post('webhooks/:eventId/replay')
  @HttpCode(200)
  replay(
    @Req() req: Request,
    @Param('eventId') eventId: string,
    @Body() value: unknown,
  ) {
    const body = object(req, value, ['deliveries']);
    if (body.deliveries !== 2 || !/^evt_[A-Za-z0-9_]{1,200}$/.test(eventId))
      invalid('event', 'Expected an event ID and exactly two deliveries.');
    return this.simulation.replay(eventId);
  }
  @Post('payments/:id/confirm')
  @HttpCode(200)
  confirm(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() value: unknown,
  ) {
    const body = object(req, value, ['scenario']);
    if (body.scenario !== 'success' && body.scenario !== 'decline')
      invalid('scenario', 'Choose success or decline.');
    return this.simulation.confirm(paymentId(id), body.scenario);
  }
}
