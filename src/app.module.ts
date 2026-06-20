import { Module } from '@nestjs/common';

import { AppConfigModule } from './config/config.module';
import { DatabaseModule } from './database/database.module';
import { HealthModule } from './health/health.module';
import { OutboxModule } from './outbox/outbox.module';
import { PaymentIntentsModule } from './payment-intents/payment-intents.module';
import { WebhooksModule } from './webhooks/webhooks.module';

@Module({
  imports: [
    AppConfigModule,
    DatabaseModule,
    HealthModule,
    OutboxModule,
    PaymentIntentsModule,
    WebhooksModule,
  ],
})
export class AppModule {}
