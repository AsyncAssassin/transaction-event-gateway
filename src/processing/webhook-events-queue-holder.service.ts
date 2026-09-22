import { Inject, Injectable, OnModuleDestroy, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue, QueueOptions } from 'bullmq';

import { LogThrottle } from '../common/logging/log-throttle';
import {
  StructuredLogger,
  toSafeErrorCode,
} from '../common/logging/structured-logger';
import {
  ProcessWebhookEventJobData,
  PROCESS_WEBHOOK_EVENT_JOB_NAME,
  PROCESS_WEBHOOK_EVENT_JOB_OPTIONS,
  WEBHOOK_EVENTS_QUEUE_NAME,
} from './queue.constants';
import { createQueueRedisConnectionOptions } from './redis-options';

export type WebhookEventsQueueFactory = (
  name: string,
  options: QueueOptions,
) => Queue<ProcessWebhookEventJobData>;

export const WEBHOOK_EVENTS_QUEUE_FACTORY = Symbol(
  'WEBHOOK_EVENTS_QUEUE_FACTORY',
);

// A Redis outage raises one connection error per reconnect attempt on every
// Queue instance, so identical poison warnings are summarized once per interval.
const QUEUE_POISON_LOG_INTERVAL_MS = 30_000;

@Injectable()
export class WebhookEventsQueueHolder implements OnModuleDestroy {
  private readonly logger = new StructuredLogger(WebhookEventsQueueHolder.name);
  private readonly poisonThrottle = new LogThrottle(
    QUEUE_POISON_LOG_INTERVAL_MS,
  );
  private currentQueue: Queue<ProcessWebhookEventJobData> | null = null;
  private poisoned = false;
  private poisonedSinceLastPublish = false;
  private recreatePromise: Promise<Queue<ProcessWebhookEventJobData>> | null =
    null;
  private destroyed = false;

  constructor(
    private readonly configService: ConfigService,
    @Optional()
    @Inject(WEBHOOK_EVENTS_QUEUE_FACTORY)
    private readonly queueFactory?: WebhookEventsQueueFactory,
  ) {}

  getQueue(): Queue<ProcessWebhookEventJobData> {
    this.assertActive();

    if (this.currentQueue && !this.poisoned) {
      return this.currentQueue;
    }

    return this.replaceQueue(this.currentQueue);
  }

  async addProcessWebhookEvent(webhookEventId: string): Promise<void> {
    const firstQueue = await this.getHealthyQueueForPublish();

    try {
      await addProcessWebhookEvent(firstQueue, webhookEventId);
      this.markPublishSucceeded();
      return;
    } catch (error) {
      this.markPoisoned(firstQueue, error);
      await this.recreateQueue(firstQueue);
    }

    const retryQueue = await this.getHealthyQueueForPublish();

    try {
      await addProcessWebhookEvent(retryQueue, webhookEventId);
      this.markPublishSucceeded();
    } catch (error) {
      this.markPoisoned(retryQueue, error);
      throw error;
    }
  }

  async onModuleDestroy(): Promise<void> {
    this.destroyed = true;

    if (this.recreatePromise) {
      await this.recreatePromise.catch(() => undefined);
    }

    const queue = this.currentQueue;
    this.currentQueue = null;
    this.poisoned = false;

    if (queue) {
      await queue.close();
    }
  }

  private async getHealthyQueueForPublish(): Promise<
    Queue<ProcessWebhookEventJobData>
  > {
    this.assertActive();

    if (this.currentQueue && !this.poisoned) {
      return this.currentQueue;
    }

    return this.recreateQueue(this.currentQueue);
  }

  private async recreateQueue(
    queueToReplace: Queue<ProcessWebhookEventJobData> | null,
  ): Promise<Queue<ProcessWebhookEventJobData>> {
    this.assertActive();

    if (this.recreatePromise) {
      return this.recreatePromise;
    }

    this.recreatePromise = Promise.resolve()
      .then(() => {
        if (
          queueToReplace &&
          this.currentQueue &&
          this.currentQueue !== queueToReplace &&
          !this.poisoned
        ) {
          return this.currentQueue;
        }

        return this.replaceQueue(this.currentQueue);
      })
      .finally(() => {
        this.recreatePromise = null;
      });

    return this.recreatePromise;
  }

  private replaceQueue(
    oldQueue: Queue<ProcessWebhookEventJobData> | null,
  ): Queue<ProcessWebhookEventJobData> {
    this.assertActive();

    const newQueue = this.createQueue();
    this.currentQueue = newQueue;
    this.poisoned = false;

    if (oldQueue && oldQueue !== newQueue) {
      this.closeQueueSafely(oldQueue);
    }

    return newQueue;
  }

  private createQueue(): Queue<ProcessWebhookEventJobData> {
    const options: QueueOptions = {
      connection: createQueueRedisConnectionOptions(
        this.configService.getOrThrow<string>('REDIS_URL'),
      ),
      defaultJobOptions: PROCESS_WEBHOOK_EVENT_JOB_OPTIONS,
      skipWaitingForReady: true,
    };
    const queue = this.buildQueue(WEBHOOK_EVENTS_QUEUE_NAME, options);

    queue.on('error', (error) => {
      this.markPoisoned(queue, error);
    });

    return queue;
  }

  private buildQueue(
    name: string,
    options: QueueOptions,
  ): Queue<ProcessWebhookEventJobData> {
    if (this.queueFactory) {
      return this.queueFactory(name, options);
    }

    return new Queue<ProcessWebhookEventJobData>(name, options);
  }

  private markPoisoned(
    queue: Queue<ProcessWebhookEventJobData>,
    error: unknown,
  ): void {
    if (this.currentQueue === queue) {
      this.poisoned = true;
    }
    this.poisonedSinceLastPublish = true;

    const errorCode = toSafeErrorCode(error, 'WEBHOOK_EVENTS_QUEUE_POISONED');
    const decision = this.poisonThrottle.shouldEmit(errorCode);
    if (!decision) {
      return;
    }

    this.logger.warn('webhook_events_queue_poisoned', {
      status: 'FAILED',
      errorCode,
      suppressedCount: decision.suppressedCount,
    });
  }

  private markPublishSucceeded(): void {
    if (!this.poisonedSinceLastPublish) {
      return;
    }

    const suppressedCount = this.poisonThrottle.reset();
    this.poisonedSinceLastPublish = false;

    this.logger.info('webhook_events_queue_recovered', {
      status: 'READY',
      suppressedCount,
    });
  }

  private closeQueueSafely(queue: Queue<ProcessWebhookEventJobData>): void {
    void queue.close().catch((error: unknown) => {
      this.logger.warn('webhook_events_queue_close_failed', {
        status: 'FAILED',
        errorCode: toSafeErrorCode(error, 'WEBHOOK_EVENTS_QUEUE_CLOSE_FAILED'),
      });
    });
  }

  private assertActive(): void {
    if (this.destroyed) {
      throw new Error('WEBHOOK_EVENTS_QUEUE_HOLDER_DESTROYED');
    }
  }
}

function addProcessWebhookEvent(
  queue: Queue<ProcessWebhookEventJobData>,
  webhookEventId: string,
): Promise<unknown> {
  return queue.add(
    PROCESS_WEBHOOK_EVENT_JOB_NAME,
    { webhookEventId },
    PROCESS_WEBHOOK_EVENT_JOB_OPTIONS,
  );
}
