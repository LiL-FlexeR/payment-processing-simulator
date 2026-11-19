import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../generated/prisma/client.js';
import { ConfigService } from '../config/config.service.js';

@Injectable()
export class DatabaseService extends PrismaClient implements OnModuleDestroy {
  constructor(config: ConfigService) {
    super({
      adapter: new PrismaPg({
        connectionString: config.values.databaseUrl,
        max: 5,
        connectionTimeoutMillis: 1000,
        idleTimeoutMillis: 10000,
        statement_timeout: 1000,
        query_timeout: 1000,
      }),
      log: [],
      errorFormat: 'minimal',
    });
  }

  async isReady(): Promise<boolean> {
    try {
      await this.$queryRaw`SELECT 1`;
      return true;
    } catch {
      // Never pass driver errors (which may contain credentials) to HTTP/logs.
      return false;
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
