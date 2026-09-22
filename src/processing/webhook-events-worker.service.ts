import {
  Injectable,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Job, Worker } from 'bullmq';

import { LogThrottle } from '../common/logging/log-throttle';
import {
  StructuredLogger,
  toSafeErrorCode,
} from '../common/logging/structured-logger';
import {
  ProcessWebhookEventJobData,
  PROCESS_WEBHOOK_EVENT_JOB_NAME,
  WEBHOOK_EVENTS_QUEUE_NAME,
} from './queue.constants';
import { createWorkerRedisConnectionOptions } from './redis-options';
import { WebhookEventProcessorService } from './webhook-event-processor.service';

// During a Redis outage BullMQ emits one error per reconnect attempt per
// connection (the worker holds two), so identical errors are summarized once
// per interval instead of once per second.
const WORKER_ERROR_LOG_INTERVAL_MS = 30_000;

@Injectable()
export class WebhookEventsWorkerService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new StructuredLogger(
    WebhookEventsWorkerService.name,
  );
  private readonly errorThrottle = new LogThrottle(
    WORKER_ERROR_LOG_INTERVAL_MS,
  );
  private worker: Worker<ProcessWebhookEventJobData> | null = null;
  private degraded = false;

  constructor(
    private readonly configService: ConfigService,
    private readonly processor: WebhookEventProcessorService,
  ) {}

  onApplicationBootstrap(): void {
    this.worker = new Worker<ProcessWebhookEventJobData>(
      WEBHOOK_EVENTS_QUEUE_NAME,
      (job) => this.process(job),
      {
        connection: createWorkerRedisConnectionOptions(
          this.configService.getOrThrow<string>('REDIS_URL'),
        ),
        concurrency: 1,
        removeOnComplete: {
          age: 3_600,
          count: 1_000,
        },
        removeOnFail: {
          age: 7 * 24 * 3_600,
          count: 5_000,
        },
      },
    );

    this.worker.on('failed', (job, error) => {
      this.logger.warn('worker_job_failed', {
        jobId: normalizeJobId(job?.id),
        webhookEventId: job?.data.webhookEventId,
        status: 'FAILED',
        errorCode: toSafeErrorCode(error, 'WORKER_JOB_FAILED'),
      });
    });
    this.worker.on('error', (error) => this.handleWorkerError(error));
    this.worker.on('ready', () => this.handleWorkerReady());
  }

  async onApplicationShutdown(): Promise<void> {
    await this.worker?.close();
  }

  private async process(job: Job<ProcessWebhookEventJobData>): Promise<void> {
    if (job.name !== PROCESS_WEBHOOK_EVENT_JOB_NAME) {
      throw new Error('UNSUPPORTED_JOB_TYPE');
    }

    const result = await this.processor.processWebhookEvent({
      webhookEventId: job.data.webhookEventId,
      jobId: job.id ?? null,
    });

    if (result.status === 'failed') {
      this.logger.warn('worker_job_failed', {
        jobId: normalizeJobId(job.id),
        webhookEventId: job.data.webhookEventId,
        status: 'FAILED',
        errorCode: result.reason,
      });
      return;
    }

    this.logger.info('worker_job_processed', {
      jobId: normalizeJobId(job.id),
      webhookEventId: job.data.webhookEventId,
      status: result.status.toUpperCase(),
    });
  }

  private handleWorkerError(error: unknown): void {
    const errorCode = toSafeErrorCode(error, 'WORKER_ERROR');
    this.degraded = true;

    const decision = this.errorThrottle.shouldEmit(errorCode);
    if (!decision) {
      return;
    }

    this.logger.error('worker_error', {
      status: 'FAILED',
      errorCode,
      suppressedCount: decision.suppressedCount,
    });
  }

  // BullMQ re-emits 'ready' every time its blocking connection reconnects, so
  // this doubles as the recovery signal after an outage.
  private handleWorkerReady(): void {
    if (!this.degraded) {
      return;
    }

    const suppressedCount = this.errorThrottle.reset();
    this.degraded = false;

    this.logger.info('worker_redis_recovered', {
      status: 'READY',
      suppressedCount,
    });
  }
}

function normalizeJobId(
  jobId: string | number | undefined,
): string | undefined {
  return jobId === undefined ? undefined : String(jobId);
}
