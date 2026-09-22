import { QueryFailedError } from 'typeorm';

import { isDatabaseUnavailableError } from './database-error';

describe('isDatabaseUnavailableError', () => {
  it('detects a node socket connection error', () => {
    const error = Object.assign(new Error('connect ECONNREFUSED'), {
      code: 'ECONNREFUSED',
    });

    expect(isDatabaseUnavailableError(error)).toBe(true);
  });

  it('detects a PostgreSQL admin shutdown code', () => {
    const error = Object.assign(new Error('terminating connection'), {
      code: '57P01',
    });

    expect(isDatabaseUnavailableError(error)).toBe(true);
  });

  it('detects a connection code wrapped in a TypeORM QueryFailedError', () => {
    const driverError = Object.assign(new Error('connection failure'), {
      code: '08006',
    });
    const error = new QueryFailedError('SELECT 1', [], driverError);

    expect(isDatabaseUnavailableError(error)).toBe(true);
  });

  it.each([
    'timeout exceeded when trying to connect',
    'Connection terminated due to connection timeout',
    'Connection terminated unexpectedly',
    'Client has encountered a connection error and is not queryable',
  ])('detects a codeless PostgreSQL unavailable message: %s', (message) => {
    expect(isDatabaseUnavailableError(new Error(message))).toBe(true);
  });

  it('detects a codeless unavailable message nested in cause', () => {
    const error = Object.assign(new Error('outer error'), {
      cause: new Error('timeout exceeded when trying to connect'),
    });

    expect(isDatabaseUnavailableError(error)).toBe(true);
  });

  it('detects a codeless unavailable message nested in driverError', () => {
    const error = Object.assign(new Error('query failed'), {
      driverError: new Error('Connection terminated due to connection timeout'),
    });

    expect(isDatabaseUnavailableError(error)).toBe(true);
  });

  it('detects a codeless unavailable message nested in errors', () => {
    const error = new AggregateError(
      [
        new Error(
          'Client has encountered a connection error and is not queryable',
        ),
      ],
      'pool failed',
    );

    expect(isDatabaseUnavailableError(error)).toBe(true);
  });

  it('does not treat an integrity constraint violation as unavailable', () => {
    const driverError = Object.assign(new Error('duplicate key'), {
      code: '23505',
    });
    const error = new QueryFailedError('INSERT ...', [], driverError);

    expect(isDatabaseUnavailableError(error)).toBe(false);
  });

  it.each(['23505', '23503', '23514', '42601', '57014'])(
    'does not treat code %s as unavailable',
    (code) => {
      expect(isDatabaseUnavailableError({ code })).toBe(false);
    },
  );

  it('does not treat statement timeout text as unavailable', () => {
    expect(isDatabaseUnavailableError(new Error('statement timeout'))).toBe(
      false,
    );
  });

  it('does not treat validation-shaped domain errors as unavailable', () => {
    const error = {
      code: 'PAYMENT_AMOUNT_INVALID',
      message: 'Payment amount failed validation',
      details: { field: 'amount' },
    };

    expect(isDatabaseUnavailableError(error)).toBe(false);
  });

  it('returns false for plain errors and non-objects', () => {
    expect(isDatabaseUnavailableError(new Error('boom'))).toBe(false);
    expect(isDatabaseUnavailableError('nope')).toBe(false);
    expect(isDatabaseUnavailableError(null)).toBe(false);
    expect(isDatabaseUnavailableError(undefined)).toBe(false);
  });
});
