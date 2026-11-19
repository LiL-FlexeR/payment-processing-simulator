import { randomUUID } from 'node:crypto';
import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  INestApplication,
} from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';

@Catch()
class SafeExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>();
    const status =
      exception instanceof HttpException ? exception.getStatus() : 500;
    response.status(status).json({
      error: {
        code:
          status === 400
            ? 'VALIDATION_ERROR'
            : status === 404
              ? 'NOT_FOUND'
              : 'INTERNAL_ERROR',
        message:
          status === 400
            ? 'This endpoint accepts no query or body.'
            : status === 404
              ? 'Endpoint not found.'
              : 'The request could not be completed.',
        requestId: response.getHeader('X-Request-Id'),
        retryable: status >= 500,
        details: null,
      },
    });
  }
}

export function configureHttp(app: INestApplication): void {
  app.setGlobalPrefix('api/v1');
  app.getHttpAdapter().getInstance().disable('x-powered-by');
  app.use((_request: Request, response: Response, next: NextFunction) => {
    const incoming = _request.headers['x-request-id'];
    const id =
      typeof incoming === 'string' &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        incoming,
      )
        ? incoming
        : randomUUID();
    response.setHeader('X-Request-Id', id);
    response.setHeader('Cache-Control', 'no-store');
    next();
  });
  app.useGlobalFilters(new SafeExceptionFilter());
}
