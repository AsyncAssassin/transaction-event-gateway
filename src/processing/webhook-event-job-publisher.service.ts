import { Injectable } from '@nestjs/common';

import { WebhookEventsQueueHolder } from './webhook-events-queue-holder.service';

@Injectable()
export class WebhookEventJobPublisher {
  constructor(private readonly queueHolder: WebhookEventsQueueHolder) {}

  async publishProcessWebhookEvent(webhookEventId: string): Promise<void> {
    await this.queueHolder.addProcessWebhookEvent(webhookEventId);
  }
}
