import { ConfigService } from '@nestjs/config';
import { ThrottlerModuleOptions } from '@nestjs/throttler';

const DEFAULT_RATE_LIMIT_TTL_SECONDS = 60;
const DEFAULT_RATE_LIMIT_LIMIT = 100;

export function isRateLimitEnabled(configService: ConfigService): boolean {
  const value = configService.get<boolean | string>('RATE_LIMIT_ENABLED');

  return value !== false && value !== 'false';
}

/**
 * Throttler options for the API process. When limiting is disabled (test
 * suites, RATE_LIMIT_ENABLED=false) the guard stays wired but skips every
 * request explicitly instead of hiding behind an enormous limit.
 */
export function createThrottlerOptions(
  configService: ConfigService,
): ThrottlerModuleOptions {
  const enabled = isRateLimitEnabled(configService);
  const ttlSeconds = Number(
    configService.get('RATE_LIMIT_TTL_SECONDS') ??
      DEFAULT_RATE_LIMIT_TTL_SECONDS,
  );
  const limit = Number(
    configService.get('RATE_LIMIT_LIMIT') ?? DEFAULT_RATE_LIMIT_LIMIT,
  );

  return {
    skipIf: () => !enabled,
    throttlers: [
      {
        ttl: ttlSeconds * 1_000,
        limit,
      },
    ],
  };
}
