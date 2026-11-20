import { timingSafeEqual } from 'node:crypto';
import {
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import type { Request } from 'express';
import { ConfigService } from '../../shared/config/config.service.js';
import { ApiError } from '../../shared/http/api-error.js';

@Injectable()
export class SimulationGuard implements CanActivate {
  private windows = new Map<string, { start: number; count: number }>();
  constructor(private readonly config: ConfigService) {}
  canActivate(context: ExecutionContext) {
    const config = this.config.values;
    if (config.nodeEnv === 'production' || !config.simulationEnabled)
      throw new ApiError('NOT_FOUND', 404, 'Endpoint not found.');
    const request = context.switchToHttp().getRequest<Request>();
    const actual = Buffer.from(request.headers.authorization ?? '');
    const expected = Buffer.from(`Bearer ${config.simulationToken}`);
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
      throw new ApiError('FORBIDDEN', 403, 'Development access rejected.');
    const now = Date.now();
    for (const [ip, window] of this.windows)
      if (now - window.start >= 60000) this.windows.delete(ip);
    const ip = request.ip ?? 'local';
    const window = this.windows.get(ip) ?? { start: now, count: 0 };
    this.windows.set(ip, window);
    if (++window.count > 30)
      throw new ApiError(
        'RATE_LIMITED',
        429,
        'Simulation limit reached. Try again later.',
        true,
      );
    return true;
  }
}
