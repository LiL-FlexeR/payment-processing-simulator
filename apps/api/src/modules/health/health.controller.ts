import { BadRequestException, Controller, Get, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { HealthService } from './health.service.js';

@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  private validate(request: Request) {
    if (
      Object.keys(request.query).length ||
      request.headers['transfer-encoding'] ||
      Number(request.headers['content-length'] ?? 0) > 0
    )
      throw new BadRequestException();
  }

  @Get('live')
  live(@Req() request: Request) {
    this.validate(request);
    return this.health.live();
  }

  @Get('ready')
  async ready(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.validate(request);
    const health = await this.health.ready();
    response.status(health.database === 'up' ? 200 : 503);
    return health;
  }
}
