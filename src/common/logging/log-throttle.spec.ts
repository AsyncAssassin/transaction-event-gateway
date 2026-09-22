import { LogThrottle } from './log-throttle';

describe('LogThrottle', () => {
  let nowMs: number;
  let throttle: LogThrottle;

  beforeEach(() => {
    nowMs = 0;
    throttle = new LogThrottle(30_000, () => nowMs);
  });

  it('emits the first occurrence of a key immediately', () => {
    expect(throttle.shouldEmit('ECONNREFUSED')).toEqual({ suppressedCount: 0 });
  });

  it('suppresses repeats inside the interval and reports them on the next emission', () => {
    throttle.shouldEmit('ECONNREFUSED');

    nowMs = 1_000;
    expect(throttle.shouldEmit('ECONNREFUSED')).toBeNull();
    nowMs = 2_000;
    expect(throttle.shouldEmit('ECONNREFUSED')).toBeNull();

    nowMs = 30_000;
    expect(throttle.shouldEmit('ECONNREFUSED')).toEqual({ suppressedCount: 2 });

    nowMs = 31_000;
    expect(throttle.shouldEmit('ECONNREFUSED')).toBeNull();
  });

  it('tracks keys independently', () => {
    throttle.shouldEmit('ECONNREFUSED');
    nowMs = 1_000;

    expect(throttle.shouldEmit('ETIMEDOUT')).toEqual({ suppressedCount: 0 });
    expect(throttle.shouldEmit('ECONNREFUSED')).toBeNull();
  });

  it('reset returns the suppressed total and starts over', () => {
    throttle.shouldEmit('ECONNREFUSED');
    throttle.shouldEmit('ECONNREFUSED');
    throttle.shouldEmit('ETIMEDOUT');
    throttle.shouldEmit('ETIMEDOUT');
    throttle.shouldEmit('ETIMEDOUT');

    expect(throttle.reset()).toBe(3);
    expect(throttle.shouldEmit('ECONNREFUSED')).toEqual({ suppressedCount: 0 });
  });
});
