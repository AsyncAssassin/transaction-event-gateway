import {
  ArgumentsHost,
  BadRequestException,
  ConflictException,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { ThrottlerException } from '@nestjs/throttler';
import { Request, Response } from 'express';

import { StructuredLogger } from '../logging/structured-logger';
import { CorrelationIdExceptionFilter } from './correlation-id-exception.filter';

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

type ResponseMock = {
  setHeader: jest.Mock;
  getHeader: jest.Mock;
  status: jest.Mock;
  json: jest.Mock;
};

function createHost(headers: Record<string, string> = {}): {
  host: ArgumentsHost;
  response: ResponseMock;
} {
  const request = {
    header: (name: string) => headers[name.toLowerCase()],
  } as unknown as Request;
  const response: ResponseMock = {
    setHeader: jest.fn(),
    getHeader: jest.fn(),
    status: jest.fn(),
    json: jest.fn(),
  };
  response.status.mockReturnValue(response);

  const host = {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response as unknown as Response,
    }),
  } as unknown as ArgumentsHost;

  return { host, response };
}

function sentBody(response: ResponseMock): Record<string, unknown> {
  return response.json.mock.calls[0]?.[0] as Record<string, unknown>;
}

describe('CorrelationIdExceptionFilter', () => {
  const filter = new CorrelationIdExceptionFilter();
  let errorLog: jest.SpyInstance;
  let warnLog: jest.SpyInstance;

  beforeEach(() => {
    errorLog = jest
      .spyOn(StructuredLogger.prototype, 'error')
      .mockImplementation(() => undefined);
    warnLog = jest
      .spyOn(StructuredLogger.prototype, 'warn')
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    errorLog.mockRestore();
    warnLog.mockRestore();
  });

  it('passes structured HttpException bodies through and echoes a safe correlation ID', () => {
    const { host, response } = createHost({
      'x-correlation-id': 'request-123',
    });

    filter.catch(
      new ConflictException({
        error: 'IDEMPOTENCY_CONFLICT',
        message: 'Key reused.',
      }),
      host,
    );

    expect(response.status).toHaveBeenCalledWith(409);
    expect(sentBody(response)).toEqual({
      error: 'IDEMPOTENCY_CONFLICT',
      message: 'Key reused.',
      correlationId: 'request-123',
    });
    expect(response.setHeader).toHaveBeenCalledWith(
      'X-Correlation-ID',
      'request-123',
    );
    expect(errorLog).not.toHaveBeenCalled();
  });

  it('replaces an unsafe inbound correlation ID with a generated one', () => {
    const { host, response } = createHost({
      'x-correlation-id': 'bad id\nwith newline',
    });

    filter.catch(
      new BadRequestException({ error: 'VALIDATION_ERROR', message: 'x' }),
      host,
    );

    expect(sentBody(response).correlationId).toMatch(uuidPattern);
  });

  it('maps the default Nest 400 body (malformed JSON) to a generic validation error', () => {
    const { host, response } = createHost();

    filter.catch(new BadRequestException('Unexpected token } in JSON'), host);

    expect(response.status).toHaveBeenCalledWith(400);
    expect(sentBody(response)).toEqual({
      error: 'VALIDATION_ERROR',
      message: 'Request could not be processed.',
      correlationId: expect.stringMatching(uuidPattern),
    });
    expect(JSON.stringify(sentBody(response))).not.toContain(
      'Unexpected token',
    );
  });

  it('classifies PostgreSQL connection failures as 503 and logs the classified code', () => {
    const { host, response } = createHost();
    const error = Object.assign(
      new Error('connect ECONNREFUSED 127.0.0.1:5432'),
      { code: 'ECONNREFUSED' },
    );

    filter.catch(error, host);

    expect(response.status).toHaveBeenCalledWith(503);
    expect(sentBody(response)).toEqual({
      error: 'SERVICE_UNAVAILABLE',
      message: 'A required datastore is temporarily unavailable.',
      correlationId: expect.stringMatching(uuidPattern),
    });
    expect(errorLog).toHaveBeenCalledWith(
      'http_request_failed',
      expect.objectContaining({
        status: 503,
        errorCode: 'SERVICE_UNAVAILABLE',
      }),
    );
  });

  it('replaces the default Nest 404 body of an unknown route with the NOT_FOUND envelope', () => {
    const { host, response } = createHost();

    filter.catch(new NotFoundException('Cannot GET /no-such-route'), host);

    expect(response.status).toHaveBeenCalledWith(404);
    expect(sentBody(response)).toEqual({
      error: 'NOT_FOUND',
      message: 'Resource not found.',
      correlationId: expect.stringMatching(uuidPattern),
    });
  });

  it('maps the rate limiter exception to RATE_LIMITED without its framework text', () => {
    const { host, response } = createHost();

    filter.catch(new ThrottlerException(), host);

    expect(response.status).toHaveBeenCalledWith(429);
    expect(sentBody(response)).toEqual({
      error: 'RATE_LIMITED',
      message:
        'Too many requests; retry after the delay in the Retry-After header.',
      correlationId: expect.stringMatching(uuidPattern),
    });
    expect(errorLog).not.toHaveBeenCalled();
  });

  it('hides the default body of a Nest 5xx exception behind the generic 500 envelope', () => {
    const { host, response } = createHost();

    filter.catch(new InternalServerErrorException('pool exhausted'), host);

    expect(response.status).toHaveBeenCalledWith(500);
    expect(sentBody(response)).toEqual({
      error: 'INTERNAL_SERVER_ERROR',
      message: 'Unexpected server error.',
      correlationId: expect.stringMatching(uuidPattern),
    });
  });

  it.each([
    [
      'an oversized body',
      Object.assign(new Error('request entity too large'), {
        status: 413,
        expose: true,
        type: 'entity.too.large',
      }),
      413,
      {
        error: 'PAYLOAD_TOO_LARGE',
        message: 'Request body exceeds the size limit.',
      },
    ],
    [
      'a gzip body that zlib cannot inflate',
      Object.assign(new Error('incorrect header check'), {
        status: 400,
        expose: true,
        code: 'Z_DATA_ERROR',
      }),
      400,
      {
        error: 'VALIDATION_ERROR',
        message: 'Request could not be processed.',
      },
    ],
    [
      'an unsupported content encoding',
      Object.assign(new Error('unsupported content encoding "x-custom"'), {
        status: 415,
        expose: true,
        type: 'encoding.unsupported',
      }),
      415,
      {
        error: 'UNSUPPORTED_MEDIA_TYPE',
        message: 'Request body encoding or charset is not supported.',
      },
    ],
    [
      'an unsupported charset',
      Object.assign(new Error('unsupported charset "LATIN1"'), {
        status: 415,
        expose: true,
        type: 'charset.unsupported',
      }),
      415,
      {
        error: 'UNSUPPORTED_MEDIA_TYPE',
        message: 'Request body encoding or charset is not supported.',
      },
    ],
    [
      'a status without a dedicated envelope',
      Object.assign(new Error('entity verify failed'), {
        status: 403,
        expose: true,
      }),
      403,
      { error: 'HTTP_ERROR', message: 'Request could not be processed.' },
    ],
  ])(
    'maps body parser errors for %s by status and never returns their message',
    (_, error, status, envelope) => {
      const { host, response } = createHost();

      filter.catch(error, host);

      expect(response.status).toHaveBeenCalledWith(status);
      expect(sentBody(response)).toEqual({
        ...envelope,
        correlationId: expect.stringMatching(uuidPattern),
      });
      expect(JSON.stringify(sentBody(response))).not.toContain(error.message);
      expect(errorLog).not.toHaveBeenCalled();
    },
  );

  it('hides unknown errors behind a generic 500 and logs a stable code when the message is one', () => {
    const { host, response } = createHost();

    filter.catch(new Error('WEBHOOK_EVENT_NOT_FOUND'), host);

    expect(response.status).toHaveBeenCalledWith(500);
    expect(sentBody(response)).toEqual({
      error: 'INTERNAL_SERVER_ERROR',
      message: 'Unexpected server error.',
      correlationId: expect.stringMatching(uuidPattern),
    });
    expect(errorLog).toHaveBeenCalledWith(
      'http_request_failed',
      expect.objectContaining({
        status: 500,
        errorCode: 'WEBHOOK_EVENT_NOT_FOUND',
      }),
    );
  });

  it('never logs free-form messages as error codes', () => {
    const { host } = createHost();

    filter.catch(new Error('something exploded with details'), host);

    expect(errorLog).toHaveBeenCalledWith(
      'http_request_failed',
      expect.objectContaining({ errorCode: 'INTERNAL_SERVER_ERROR' }),
    );
  });

  it('logs the error name, cause code, and top stack frames of a 500 without its message', () => {
    const { host } = createHost();
    const error = Object.assign(new RangeError('value "cust_123" too deep'), {
      code: 'ERR_SOMETHING',
    });

    filter.catch(error, host);

    expect(errorLog).toHaveBeenCalledWith(
      'http_request_failed',
      expect.objectContaining({
        status: 500,
        errorCode: 'INTERNAL_SERVER_ERROR',
        errorName: 'RangeError',
        causeCode: 'ERR_SOMETHING',
        stackTop: expect.stringMatching(/^at /),
      }),
    );
    expect(JSON.stringify(errorLog.mock.calls)).not.toContain('cust_123');
  });

  it('maps PostgreSQL data exceptions to 400 and warns with the SQLSTATE', () => {
    const { host, response } = createHost();
    const error = Object.assign(
      new Error('invalid byte sequence for encoding "UTF8": 0x00'),
      { name: 'QueryFailedError', driverError: { code: '22021' } },
    );

    filter.catch(error, host);

    expect(response.status).toHaveBeenCalledWith(400);
    expect(sentBody(response)).toEqual({
      error: 'VALIDATION_ERROR',
      message: 'Request could not be processed.',
      correlationId: expect.stringMatching(uuidPattern),
    });
    expect(errorLog).not.toHaveBeenCalled();
    expect(warnLog).toHaveBeenCalledWith('http_request_data_exception', {
      correlationId: expect.stringMatching(uuidPattern),
      status: 400,
      errorCode: 'DATABASE_DATA_EXCEPTION',
      causeCode: '22021',
    });
  });
});
