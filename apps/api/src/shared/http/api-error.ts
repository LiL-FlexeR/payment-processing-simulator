import { HttpException } from '@nestjs/common';

export type ValidationDetail = { field: string; message: string };

export class ApiError extends HttpException {
  constructor(
    readonly code: string,
    status: number,
    message: string,
    readonly retryable = false,
    readonly details: ValidationDetail[] | null = null,
    readonly retryAfterSeconds?: number,
  ) {
    super(message, status);
  }
}

export function invalid(field: string, message: string): never {
  throw new ApiError('VALIDATION_ERROR', 400, 'Invalid request.', false, [
    { field, message },
  ]);
}

export function databaseUnavailable(): ApiError {
  return new ApiError(
    'DATABASE_UNAVAILABLE',
    503,
    'Persistence is temporarily unavailable. Retry the same operation.',
    true,
  );
}
