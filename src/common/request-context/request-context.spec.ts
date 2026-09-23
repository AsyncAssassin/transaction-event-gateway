import {
  createRequestContext,
  getCorrelationId,
  getRequestContext,
  runWithCorrelationId,
  runWithRequestContext,
} from './request-context';

describe('request context', () => {
  it('uses an inbound safe correlation ID', () => {
    const context = createRequestContext('request-123');

    expect(context.correlationId).toBe('request-123');
    expect(context.requestId).toEqual(expect.any(String));
  });

  it('generates a correlation ID when one is missing or unsafe', () => {
    const missing = createRequestContext(undefined);
    const unsafe = createRequestContext('bad\nid');

    expect(missing.correlationId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    expect(unsafe.correlationId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it('makes the context available inside async work', async () => {
    const context = createRequestContext('request-456');

    await runWithRequestContext(context, async () => {
      await Promise.resolve();
      expect(getRequestContext()).toBe(context);
    });
  });

  it('runs background work under a stored correlation ID with its own request ID', async () => {
    const outer = createRequestContext('request-789');

    await runWithRequestContext(outer, () =>
      runWithCorrelationId('request-789', async () => {
        await Promise.resolve();
        expect(getCorrelationId()).toBe('request-789');
        expect(getRequestContext()?.requestId).not.toBe(outer.requestId);
      }),
    );
  });

  it.each([undefined, '', 'bad id with spaces', 'x'.repeat(256)])(
    'runs background work without a context for the correlation ID %p',
    (correlationId) => {
      const result = runWithCorrelationId(correlationId, () =>
        getRequestContext(),
      );

      expect(result).toBeUndefined();
    },
  );
});
