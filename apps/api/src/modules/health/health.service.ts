import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../shared/database/database.service.js';

@Injectable()
export class HealthService {
  constructor(private readonly database: DatabaseService) {}

  live() {
    return { status: 'ok' as const };
  }

  async ready() {
    return (await this.database.isReady())
      ? { status: 'ready' as const, database: 'up' as const }
      : { status: 'not_ready' as const, database: 'down' as const };
  }
}
