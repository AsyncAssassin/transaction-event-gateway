import { describeError } from './describe-error';

describe('describeError', () => {
  it('returns the error name, a safe cause code, and the top stack frames without the message', () => {
    const error = Object.assign(
      new Error('invalid input value "secret@example.com"'),
      { code: '22P02' },
    );
    error.stack = [
      'Error: invalid input value "secret@example.com"',
      '    at PostgresQueryRunner.query (/app/node_modules/typeorm/driver/postgres/PostgresQueryRunner.js:219:19)',
      '    at process.processTicksAndRejections (node:internal/process/task_queues:105:5)',
      '    at async InsertQueryBuilder.execute (/app/node_modules/typeorm/query-builder/InsertQueryBuilder.js:106:33)',
      '    at async PaymentIntentsService.createPaymentIntent (/app/dist/payment-intents/payment-intents.service.js:60:28)',
      '    at async Other.frame (/app/dist/other.js:1:1)',
    ].join('\n');

    const diagnostics = describeError(error);

    expect(diagnostics).toEqual({
      errorName: 'Error',
      causeCode: '22P02',
      stackTop:
        'at PostgresQueryRunner.query (/app/node_modules/typeorm/driver/postgres/PostgresQueryRunner.js:219:19) | ' +
        'at async InsertQueryBuilder.execute (/app/node_modules/typeorm/query-builder/InsertQueryBuilder.js:106:33) | ' +
        'at async PaymentIntentsService.createPaymentIntent (/app/dist/payment-intents/payment-intents.service.js:60:28)',
    });
    expect(JSON.stringify(diagnostics)).not.toContain('secret@example.com');
  });

  it('skips every line of a multi-line message, even one that looks like a frame', () => {
    const error = new TypeError('first line\n    at injected (value)');
    error.stack = [
      'TypeError: first line',
      '    at injected (value)',
      '    at realFrame (/app/dist/main.js:1:1)',
    ].join('\n');

    expect(describeError(error)).toEqual({
      errorName: 'TypeError',
      stackTop: 'at realFrame (/app/dist/main.js:1:1)',
    });
  });

  it('finds the SQLSTATE inside a TypeORM driverError', () => {
    const error = Object.assign(new Error('query failed'), {
      name: 'QueryFailedError',
      driverError: { code: '22021' },
    });

    expect(describeError(error)).toMatchObject({
      errorName: 'QueryFailedError',
      causeCode: '22021',
    });
  });

  it('follows the cause chain', () => {
    const error = new Error('publish failed', {
      cause: Object.assign(new Error('socket closed'), { code: 'ECONNRESET' }),
    });

    expect(describeError(error)).toMatchObject({
      errorName: 'Error',
      causeCode: 'ECONNRESET',
    });
  });

  it('finds errno codes inside an AggregateError from a connection attempt', () => {
    const error = new AggregateError(
      [
        Object.assign(new Error('connect ECONNREFUSED ::1:5432'), {
          code: 'ECONNREFUSED',
        }),
      ],
      'connect failed',
    );

    expect(describeError(error)).toMatchObject({
      errorName: 'AggregateError',
      causeCode: 'ECONNREFUSED',
    });
  });

  it('ignores codes that do not match the safe pattern', () => {
    const error = Object.assign(new Error('x'), { code: 'value with spaces' });

    expect(describeError(error).causeCode).toBeUndefined();
  });

  it('describes thrown non-error values without echoing them', () => {
    expect(describeError('password=hunter2')).toEqual({
      errorName: 'NonErrorValue',
    });
  });
});
