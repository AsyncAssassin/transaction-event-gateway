import {
  createRequestContext,
  getRequestContext,
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
});
