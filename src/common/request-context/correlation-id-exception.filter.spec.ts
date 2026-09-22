import {
  ArgumentsHost,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
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

  it('maps body-parser style errors that carry their own status', () => {
    const { host, response } = createHost();
    const error = Object.assign(new Error('request entity too large'), {
      status: 413,
      expose: true,
    });

    filter.catch(error, host);

    expect(response.status).toHaveBeenCalledWith(413);
    expect(sentBody(response)).toEqual({
      error: 'PAYLOAD_TOO_LARGE',
      message: 'request entity too large',
      correlationId: expect.stringMatching(uuidPattern),
    });
    expect(errorLog).not.toHaveBeenCalled();
  });

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
