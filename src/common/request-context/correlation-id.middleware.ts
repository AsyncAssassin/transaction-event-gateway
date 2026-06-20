import { NextFunction, Request, Response } from 'express';

import {
  createRequestContext,
  runWithRequestContext,
} from './request-context';

export const CORRELATION_ID_HEADER = 'X-Correlation-ID';

export function correlationIdMiddleware(
  request: Request,
  response: Response,
  next: NextFunction,
): void {
  const context = createRequestContext(request.header(CORRELATION_ID_HEADER));

  response.setHeader(CORRELATION_ID_HEADER, context.correlationId);
  runWithRequestContext(context, next);
}
