import { randomUUID } from 'node:crypto';
import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  INestApplication,
  Logger,
} from '@nestjs/common';
import { json, type NextFunction, type Request, type Response } from 'express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { ConfigService } from '../config/config.service.js';
import {
  isDatabaseUnavailable,
  isTransactionConflict,
} from '../database/database-errors.js';
import { ApiError, databaseUnavailable, invalid } from './api-error.js';

@Catch()
class SafeExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>();
    let safe = exception instanceof ApiError ? exception : null;
    if (isDatabaseUnavailable(exception) || isTransactionConflict(exception))
      safe = databaseUnavailable();
    const status =
      safe?.getStatus() ??
      (exception instanceof HttpException ? exception.getStatus() : 500);
    const code =
      safe?.code ??
      (status === 400
        ? 'VALIDATION_ERROR'
        : status === 404
          ? 'NOT_FOUND'
          : 'INTERNAL_ERROR');
    const retryable = safe?.retryable ?? status >= 500;
    response.locals.errorCode = code;
    if (retryable && status === 503) response.setHeader('Retry-After', '1');
    response.status(status).json({
      error: {
        code,
        message:
          safe?.message ??
          (status === 400
            ? 'Invalid request.'
            : status === 404
              ? 'Endpoint not found.'
              : 'The request could not be completed.'),
        requestId: response.getHeader('X-Request-Id'),
        retryable,
        details: safe?.details ?? null,
      },
    });
  }
}

export function configureHttp(app: INestApplication): void {
  const logger = new Logger('Http');
  // One local API process; this limiter protects writes, never payment correctness.
  const writeWindows = new Map<string, { start: number; count: number }>();
  app.setGlobalPrefix('api/v1');
  app.getHttpAdapter().getInstance().disable('x-powered-by');
  app.use((request: Request, response: Response, next: NextFunction) => {
    const started = Date.now();
    const incoming = request.headers['x-request-id'];
    const id =
      typeof incoming === 'string' &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        incoming,
      )
        ? incoming
        : randomUUID();
    response.setHeader('X-Request-Id', id);
    response.setHeader('Cache-Control', 'no-store');
    response.on('finish', () =>
      logger.log(
        JSON.stringify({
          event: 'http_request',
          requestId: id,
          method: request.method,
          route: request.route?.path ?? 'unmatched',
          status: response.statusCode,
          durationMs: Date.now() - started,
          ...(response.locals.errorCode
            ? { code: response.locals.errorCode }
            : {}),
          ...(response.hasHeader('Idempotency-Replayed')
            ? {
                replayed: response.getHeader('Idempotency-Replayed') === 'true',
              }
            : {}),
        }),
      ),
    );
    try {
      const singletons = new Set<string>();
      for (let index = 0; index < request.rawHeaders.length; index += 2) {
        const name = request.rawHeaders[index]!.toLowerCase();
        if (!['idempotency-key', 'x-request-id', 'content-type'].includes(name))
          continue;
        if (singletons.has(name))
          invalid('headers', 'Duplicate singleton headers are not accepted.');
        singletons.add(name);
      }
      if (
        request.method === 'POST' &&
        /^\/api\/v1\/payments\/?$/i.test(request.path)
      ) {
        const now = Date.now();
        for (const [ip, window] of writeWindows)
          if (now - window.start >= 60000) writeWindows.delete(ip);
        const ip = request.ip ?? 'local';
        const window = writeWindows.get(ip) ?? { start: now, count: 0 };
        window.count++;
        writeWindows.set(ip, window);
        if (window.count > 120) {
          response.setHeader(
            'Retry-After',
            String(
              Math.max(1, Math.ceil((60000 - (now - window.start)) / 1000)),
            ),
          );
          throw new ApiError(
            'RATE_LIMITED',
            429,
            'Write request limit reached. Retry later.',
            true,
          );
        }
        if (!request.is('application/json'))
          throw new ApiError(
            'UNSUPPORTED_MEDIA_TYPE',
            415,
            'Expected application/json.',
          );
      }
    } catch (error) {
      next(error);
      return;
    }
    next();
  });
  // Register after correlation middleware so parser failures have safe request IDs.
  const parseJson = json({ limit: '16kb', strict: false });
  app.use((request: Request, response: Response, next: NextFunction) => {
    // Normalize parser failures before Nest wraps SyntaxError/HTTP errors.
    parseJson(request, response, (error?: unknown) => {
      const type = (error as { type?: string } | null)?.type;
      if (type === 'entity.parse.failed')
        return next(new ApiError('VALIDATION_ERROR', 400, 'Malformed JSON.'));
      if (type === 'entity.too.large')
        return next(
          new ApiError('PAYLOAD_TOO_LARGE', 413, 'JSON body exceeds 16 KiB.'),
        );
      if (type === 'charset.unsupported' || type === 'encoding.unsupported')
        return next(
          new ApiError(
            'UNSUPPORTED_MEDIA_TYPE',
            415,
            'Unsupported JSON encoding.',
          ),
        );
      next(error);
    });
  });
  app.useGlobalFilters(new SafeExceptionFilter());
  if (app.get(ConfigService).values.nodeEnv !== 'production') {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle('Payment Processing Simulator')
        .setDescription(
          'Stage 2: local payment persistence and reads. No provider operations.',
        )
        .setVersion('1')
        .build(),
    );
    // DTOs describe exact objects; reject unlisted body fields at runtime too.
    const create = document.components?.schemas?.CreatePaymentDto;
    if (create && !('$ref' in create)) create.additionalProperties = false;
    SwaggerModule.setup('api/docs', app, document);
  }
}
