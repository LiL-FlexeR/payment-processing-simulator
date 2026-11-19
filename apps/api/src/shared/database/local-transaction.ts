import { randomInt } from 'node:crypto';
import { setTimeout } from 'node:timers/promises';
import type { Prisma } from '../../generated/prisma/client.js';
import type { DatabaseService } from './database.service.js';
import { isTransactionConflict } from './database-errors.js';
import { databaseUnavailable } from '../http/api-error.js';

// Only short local work belongs here. Never include a provider call in the callback.
export async function localTransaction<T>(
  db: DatabaseService,
  work: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await db.$transaction(work, {
        isolationLevel: 'ReadCommitted',
        maxWait: 2000,
        timeout: 3000,
      });
    } catch (error) {
      if (!isTransactionConflict(error)) throw error;
      if (attempt >= 3) throw databaseUnavailable();
      await setTimeout(randomInt(10, 31) * (attempt + 1));
    }
  }
}
export async function databaseTime(
  tx: Prisma.TransactionClient,
): Promise<Date> {
  const rows = await tx.$queryRaw<
    { now: Date }[]
  >`SELECT clock_timestamp() AS now`;
  return rows[0]!.now;
}
