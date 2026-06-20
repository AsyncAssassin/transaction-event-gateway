import { BadRequestException } from '@nestjs/common';

import {
  createStructuredLogEntry,
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
    expect(toSafeErrorCode(new Error('redis password leaked'), 'FALLBACK')).toBe(
      'FALLBACK',
    );
  });
});
