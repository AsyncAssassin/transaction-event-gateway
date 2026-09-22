import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';

import { AppConfigModule } from './config/config.module';
import { DatabaseModule } from './database/database.module';
import { HealthModule } from './health/health.module';
import { PaymentIntentsModule } from './payment-intents/payment-intents.module';
import { WebhooksModule } from './webhooks/webhooks.module';

// Effectively unlimited: used to keep the guard wired while disabling limiting
// (test suites, or RATE_LIMIT_ENABLED=false) without special-casing the guard.
const RATE_LIMIT_DISABLED = Number.MAX_SAFE_INTEGER;

@Module({
  imports: [
    AppConfigModule,
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const enabled =
          configService.get<boolean | string>('RATE_LIMIT_ENABLED') !== false &&
          configService.get<boolean | string>('RATE_LIMIT_ENABLED') !== 'false';
        const ttlSeconds = Number(
          configService.get('RATE_LIMIT_TTL_SECONDS') ?? 60,
        );
        const limit = Number(configService.get('RATE_LIMIT_LIMIT') ?? 100);

        return {
          throttlers: [
            {
              ttl: ttlSeconds * 1_000,
              limit: enabled ? limit : RATE_LIMIT_DISABLED,
            },
          ],
        };
      },
    }),
    DatabaseModule,
    HealthModule,
    PaymentIntentsModule,
    WebhooksModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
