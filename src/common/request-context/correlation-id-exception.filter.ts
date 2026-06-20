import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Response } from 'express';

import { getCorrelationId } from './request-context';

@Catch()
export class CorrelationIdExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    response.status(status).json(this.toResponseBody(exception));
  }

  private toResponseBody(exception: unknown): Record<string, unknown> {
    const correlationId = getCorrelationId();

    if (exception instanceof HttpException) {
      const exceptionResponse = exception.getResponse();
      const body: Record<string, unknown> =
        typeof exceptionResponse === 'object' && exceptionResponse !== null
          ? { ...(exceptionResponse as Record<string, unknown>) }
          : {
              error: 'HTTP_ERROR',
              message: exceptionResponse,
            };

      if (correlationId) {
        body.correlationId = correlationId;
      }

      return body;
    }

    return {
      error: 'INTERNAL_SERVER_ERROR',
      message: 'Unexpected server error.',
      ...(correlationId ? { correlationId } : {}),
    };
  }
}
