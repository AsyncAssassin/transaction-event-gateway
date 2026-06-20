import { NextFunction, Request, Response } from 'express';

import { getRequestContext } from '../request-context/request-context';
import { StructuredLogger } from './structured-logger';

const httpLogger = new StructuredLogger('HttpRequest');

export function httpRequestLoggingMiddleware(
  request: Request,
  response: Response,
  next: NextFunction,
): void {
  const startedAt = Date.now();

  response.on('finish', () => {
    const requestContext = getRequestContext();

    httpLogger.info('http_request_completed', {
      method: request.method,
      path: request.path,
      status: response.statusCode,
      durationMs: Date.now() - (requestContext?.startedAt ?? startedAt),
    });
  });

  next();
}
