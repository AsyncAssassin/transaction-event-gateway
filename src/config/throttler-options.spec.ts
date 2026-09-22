import { ExecutionContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ThrottlerModuleOptions } from '@nestjs/throttler';

import {
  createThrottlerOptions,
  isRateLimitEnabled,
} from './throttler-options';

function configWith(values: Record<string, unknown>): ConfigService {
  return {
    get: jest.fn((key: string) => values[key]),
  } as unknown as ConfigService;
}

function skipsRequests(options: ThrottlerModuleOptions): boolean {
  const { skipIf } = options as {
    skipIf?: (context: ExecutionContext) => boolean;
  };

  return skipIf?.({} as ExecutionContext) ?? false;
}

describe('throttler options', () => {
  it('limits requests per window when enabled', () => {
    const options = createThrottlerOptions(
      configWith({
        RATE_LIMIT_ENABLED: true,
        RATE_LIMIT_TTL_SECONDS: 30,
        RATE_LIMIT_LIMIT: 5,
      }),
    );

    expect(options).toMatchObject({ throttlers: [{ ttl: 30_000, limit: 5 }] });
    expect(skipsRequests(options)).toBe(false);
  });

  it('skips every request explicitly when disabled instead of raising the limit', () => {
    const options = createThrottlerOptions(
      configWith({
        RATE_LIMIT_ENABLED: false,
        RATE_LIMIT_TTL_SECONDS: 30,
        RATE_LIMIT_LIMIT: 5,
      }),
    );

    expect(skipsRequests(options)).toBe(true);
    expect(options).toMatchObject({ throttlers: [{ ttl: 30_000, limit: 5 }] });
  });

  it('treats the string "false" as disabled and everything else as enabled', () => {
    expect(
      isRateLimitEnabled(configWith({ RATE_LIMIT_ENABLED: 'false' })),
    ).toBe(false);
    expect(isRateLimitEnabled(configWith({ RATE_LIMIT_ENABLED: 'true' }))).toBe(
      true,
    );
    expect(isRateLimitEnabled(configWith({}))).toBe(true);
  });

  it('falls back to the documented defaults', () => {
    const options = createThrottlerOptions(
      configWith({ RATE_LIMIT_ENABLED: true }),
    );

    expect(options).toMatchObject({
      throttlers: [{ ttl: 60_000, limit: 100 }],
    });
  });
});
