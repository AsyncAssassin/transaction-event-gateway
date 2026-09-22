import { BadRequestException } from '@nestjs/common';

import {
  createStructuredLogEntry,
  isSafeErrorCode,
  toSafeErrorCode,
} from './structured-logger';

describe('structured logging helpers', () => {
  it('keeps only approved scalar log fields', () => {
    const entry = createStructuredLogEntry('webhook_rejected', {
      provider: 'blockchain',
      externalEventId: 'evt_123',
      status: 'REJECTED',
      errorCode: 'INVALID_WEBHOOK_SIGNATURE',
      signature: 'v1=secret-signature',
      rawBody: '{"secret":true}',
      metadata: {
        customerId: 'cust_123',
      },
    } as Record<string, unknown>);

    expect(entry).toEqual({
      event: 'webhook_rejected',
      provider: 'blockchain',
      externalEventId: 'evt_123',
      status: 'REJECTED',
      errorCode: 'INVALID_WEBHOOK_SIGNATURE',
    });
  });

  it('extracts stable error codes from HTTP exceptions', () => {
    expect(
      toSafeErrorCode(
        new BadRequestException({
          error: 'VALIDATION_ERROR',
          message: 'Request validation failed.',
        }),
        'FALLBACK',
      ),
    ).toBe('VALIDATION_ERROR');
  });

  it('falls back instead of logging arbitrary error messages as codes', () => {
    expect(
      toSafeErrorCode(new Error('redis password leaked'), 'FALLBACK'),
    ).toBe('FALLBACK');
  });

  it('keeps numeric suppressedCount so throttled warnings stay measurable', () => {
    expect(
      createStructuredLogEntry('worker_error', {
        errorCode: 'ECONNREFUSED',
        suppressedCount: 12,
      }),
    ).toEqual({
      event: 'worker_error',
      errorCode: 'ECONNREFUSED',
      suppressedCount: 12,
    });
  });

  it('recognizes stable error codes and rejects free-form text', () => {
    expect(isSafeErrorCode('SERVICE_UNAVAILABLE')).toBe(true);
    expect(isSafeErrorCode('Internal Server Error')).toBe(false);
    expect(isSafeErrorCode(undefined)).toBe(false);
  });
});
