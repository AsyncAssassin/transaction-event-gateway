import { Module } from '@nestjs/common';

import { WebhookEventsService } from './webhook-events.service';
import { WebhooksController } from './webhooks.controller';

@Module({
  controllers: [WebhooksController],
  providers: [WebhookEventsService],
})
export class WebhooksModule {}
