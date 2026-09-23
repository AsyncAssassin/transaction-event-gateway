import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Request, Response } from 'express';

import {
  findPostgresDataExceptionCode,
  isDatabaseUnavailableError,
} from '../errors/database-error';
import { describeError } from '../errors/describe-error';
import {
  isSafeErrorCode,
  StructuredLogger,
  toSafeErrorCode,
} from '../logging/structured-logger';
import { CORRELATION_ID_HEADER } from './correlation-id.middleware';
import { createRequestContext, getCorrelationId } from './request-context';

const logger = new StructuredLogger('HttpException');

type ResolvedError = {
  status: number;
  body: Record<string, unknown>;
  dataExceptionCode?: string;
};

type ErrorEnvelope = {
  error: string;
  message: string;
};

// Envelopes for errors whose own text must not reach the client: Nest's
// defaults ("Cannot GET /x", "ThrottlerException: Too Many Requests"), and
// body parser and zlib messages, which describe parser internals or echo
// request headers.
const STATUS_ERROR_ENVELOPES: Readonly<Record<number, ErrorEnvelope>> = {
  [HttpStatus.BAD_REQUEST]: {
    error: 'VALIDATION_ERROR',
    message: 'Request could not be processed.',
  },
  [HttpStatus.NOT_FOUND]: {
    error: 'NOT_FOUND',
    message: 'Resource not found.',
  },
  [HttpStatus.PAYLOAD_TOO_LARGE]: {
    error: 'PAYLOAD_TOO_LARGE',
    message: 'Request body exceeds the size limit.',
  },
  [HttpStatus.UNSUPPORTED_MEDIA_TYPE]: {
    error: 'UNSUPPORTED_MEDIA_TYPE',
    message: 'Request body encoding or charset is not supported.',
  },
  [HttpStatus.TOO_MANY_REQUESTS]: {
    error: 'RATE_LIMITED',
    message:
      'Too many requests; retry after the delay in the Retry-After header.',
  },
};

@Catch()
export class CorrelationIdExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();
    const { status, body, dataExceptionCode } = this.resolve(exception);

    const correlationId = resolveCorrelationId(request, response);
    body.correlationId = correlationId;
    response.setHeader(CORRELATION_ID_HEADER, correlationId);

    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      logger.error('http_request_failed', {
        correlationId,
        status,
        errorCode: resolveLogErrorCode(exception, body),
        ...describeError(exception),
      });
    } else if (dataExceptionCode) {
      // Request validation should have rejected the value before PostgreSQL
      // did, so keep a trace of which SQLSTATE got through.
      logger.warn('http_request_data_exception', {
        correlationId,
        status,
        errorCode: 'DATABASE_DATA_EXCEPTION',
        causeCode: dataExceptionCode,
      });
    }

    response.status(status).json(body);
  }

  private resolve(exception: unknown): ResolvedError {
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const exceptionResponse = exception.getResponse();

      // Application exceptions already carry the error envelope; Nest's own
      // exceptions carry framework text and get the envelope for their status.
      return {
        status,
        body: isErrorEnvelope(exceptionResponse)
          ? { ...exceptionResponse }
          : envelopeForStatus(status),
      };
    }

    if (isDatabaseUnavailableError(exception)) {
      return {
        status: HttpStatus.SERVICE_UNAVAILABLE,
        body: {
          error: 'SERVICE_UNAVAILABLE',
          message: 'A required datastore is temporarily unavailable.',
        },
      };
    }

    const dataExceptionCode = findPostgresDataExceptionCode(exception);
    if (dataExceptionCode) {
      return {
        status: HttpStatus.BAD_REQUEST,
        body: {
          error: 'VALIDATION_ERROR',
          message: 'Request could not be processed.',
        },
        dataExceptionCode,
      };
    }

    const httpErrorStatus = extractHttpErrorStatus(exception);
    if (httpErrorStatus !== null) {
      return {
        status: httpErrorStatus,
        body: envelopeForStatus(httpErrorStatus),
      };
    }

    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      body: {
        error: 'INTERNAL_SERVER_ERROR',
        message: 'Unexpected server error.',
      },
    };
  }
}

// Prefer a stable code carried by the exception itself; otherwise log the
// classified code the client receives (for example SERVICE_UNAVAILABLE for a
// datastore outage) instead of a generic INTERNAL_SERVER_ERROR.
function resolveLogErrorCode(
  exception: unknown,
  body: Record<string, unknown>,
): string {
  const classifiedCode = isSafeErrorCode(body.error)
    ? body.error
    : 'INTERNAL_SERVER_ERROR';

  return toSafeErrorCode(exception, classifiedCode);
}

function resolveCorrelationId(request: Request, response: Response): string {
  const activeCorrelationId = getCorrelationId();
  if (activeCorrelationId) {
    return activeCorrelationId;
  }

  const responseCorrelationId = response.getHeader(CORRELATION_ID_HEADER);
  if (typeof responseCorrelationId === 'string' && responseCorrelationId) {
    return responseCorrelationId;
  }

  return createRequestContext(request.header(CORRELATION_ID_HEADER))
    .correlationId;
}

function isErrorEnvelope(
  value: unknown,
): value is ErrorEnvelope & Record<string, unknown> {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const candidate = value as { error?: unknown; message?: unknown };

  return (
    isSafeErrorCode(candidate.error) && typeof candidate.message === 'string'
  );
}

function envelopeForStatus(status: number): ErrorEnvelope {
  const envelope = STATUS_ERROR_ENVELOPES[status];

  if (envelope) {
    return { ...envelope };
  }

  return status >= HttpStatus.INTERNAL_SERVER_ERROR
    ? { error: 'INTERNAL_SERVER_ERROR', message: 'Unexpected server error.' }
    : { error: 'HTTP_ERROR', message: 'Request could not be processed.' };
}

function extractHttpErrorStatus(exception: unknown): number | null {
  if (exception === null || typeof exception !== 'object') {
    return null;
  }

  const candidate = exception as { status?: unknown; statusCode?: unknown };
  const status =
    typeof candidate.status === 'number'
      ? candidate.status
      : typeof candidate.statusCode === 'number'
        ? candidate.statusCode
        : null;

  if (status === null || status < 400 || status > 599) {
    return null;
  }

  return status;
}
