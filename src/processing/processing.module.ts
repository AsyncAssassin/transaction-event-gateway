import { Module } from '@nestjs/common';

import { WebhookEventProcessorService } from './webhook-event-processor.service';

@Module({
  providers: [WebhookEventProcessorService],
  exports: [WebhookEventProcessorService],
})
export class ProcessingModule {}
