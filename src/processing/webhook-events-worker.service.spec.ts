import { hasExhaustedAttempts } from './webhook-events-worker.service';

describe('hasExhaustedAttempts', () => {
  it('is false while BullMQ still has attempts left', () => {
    expect(
      hasExhaustedAttempts({ attemptsMade: 4, opts: { attempts: 5 } }),
    ).toBe(false);
  });

  it('is true once the configured attempts are used up', () => {
    expect(
      hasExhaustedAttempts({ attemptsMade: 5, opts: { attempts: 5 } }),
    ).toBe(true);
  });

  it('treats a job without an attempts option as a single attempt', () => {
    expect(hasExhaustedAttempts({ attemptsMade: 1, opts: {} })).toBe(true);
  });
});
