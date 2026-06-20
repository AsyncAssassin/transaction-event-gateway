import { Inject, Injectable, Module, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';

import {
  ProcessWebhookEventJobData,
  PROCESS_WEBHOOK_EVENT_JOB_OPTIONS,
  WEBHOOK_EVENTS_QUEUE,
  WEBHOOK_EVENTS_QUEUE_NAME,
} from './queue.constants';
import { createQueueRedisConnectionOptions } from './redis-options';
import { WebhookEventJobPublisher } from './webhook-event-job-publisher.service';

@Injectable()
class QueueShutdown implements OnModuleDestroy {
  constructor(
    @Inject(WEBHOOK_EVENTS_QUEUE)
    private readonly webhookEventsQueue: Queue<ProcessWebhookEventJobData>,
  ) {}

  async onModuleDestroy(): Promise<void> {
    await this.webhookEventsQueue.close();
  }
}

@Module({
  providers: [
    {
      provide: WEBHOOK_EVENTS_QUEUE,
      inject: [ConfigService],
      useFactory: (configService: ConfigService) =>
        new Queue<ProcessWebhookEventJobData>(WEBHOOK_EVENTS_QUEUE_NAME, {
          connection: createQueueRedisConnectionOptions(
            configService.getOrThrow<string>('REDIS_URL'),
          ),
          defaultJobOptions: PROCESS_WEBHOOK_EVENT_JOB_OPTIONS,
          skipWaitingForReady: true,
        }),
    },
    WebhookEventJobPublisher,
    QueueShutdown,
  ],
  exports: [WEBHOOK_EVENTS_QUEUE, WebhookEventJobPublisher],
})
export class QueuesModule {}
