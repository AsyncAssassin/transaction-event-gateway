import { Inject, Injectable } from '@nestjs/common';
import { Queue } from 'bullmq';

import {
  ProcessWebhookEventJobData,
  PROCESS_WEBHOOK_EVENT_JOB_NAME,
  PROCESS_WEBHOOK_EVENT_JOB_OPTIONS,
  WEBHOOK_EVENTS_QUEUE,
} from './queue.constants';

@Injectable()
export class WebhookEventJobPublisher {
  constructor(
    @Inject(WEBHOOK_EVENTS_QUEUE)
    private readonly webhookEventsQueue: Queue<ProcessWebhookEventJobData>,
  ) {}

  async publishProcessWebhookEvent(webhookEventId: string): Promise<void> {
    await this.webhookEventsQueue.add(
      PROCESS_WEBHOOK_EVENT_JOB_NAME,
      { webhookEventId },
      PROCESS_WEBHOOK_EVENT_JOB_OPTIONS,
    );
  }
}
