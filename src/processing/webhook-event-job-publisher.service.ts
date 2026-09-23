import { Injectable } from '@nestjs/common';

import { ProcessWebhookEventJobData } from './queue.constants';
import { WebhookEventsQueueHolder } from './webhook-events-queue-holder.service';

@Injectable()
export class WebhookEventJobPublisher {
  constructor(private readonly queueHolder: WebhookEventsQueueHolder) {}

  async publishProcessWebhookEvent(
    data: ProcessWebhookEventJobData,
  ): Promise<void> {
    await this.queueHolder.addProcessWebhookEvent(data);
  }
}
