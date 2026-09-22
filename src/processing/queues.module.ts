import { Module } from '@nestjs/common';

import { WEBHOOK_EVENTS_QUEUE } from './queue.constants';
import { WebhookEventJobPublisher } from './webhook-event-job-publisher.service';
import { WebhookEventsQueueHolder } from './webhook-events-queue-holder.service';

@Module({
  providers: [
    WebhookEventsQueueHolder,
    {
      provide: WEBHOOK_EVENTS_QUEUE,
      inject: [WebhookEventsQueueHolder],
      useFactory: (queueHolder: WebhookEventsQueueHolder) =>
        queueHolder.getQueue(),
    },
    WebhookEventJobPublisher,
  ],
  exports: [
    WEBHOOK_EVENTS_QUEUE,
    WebhookEventJobPublisher,
    WebhookEventsQueueHolder,
  ],
})
export class QueuesModule {}
