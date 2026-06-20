import {
  Injectable,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Job, Worker } from 'bullmq';

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

@Injectable()
export class WebhookEventsWorkerService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new StructuredLogger(WebhookEventsWorkerService.name);
  private worker: Worker<ProcessWebhookEventJobData> | null = null;

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
    this.worker.on('error', (error) => {
      this.logger.error('worker_error', {
        status: 'FAILED',
        errorCode: toSafeErrorCode(error, 'WORKER_ERROR'),
      });
    });
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
}

function normalizeJobId(jobId: string | number | undefined): string | undefined {
  return jobId === undefined ? undefined : String(jobId);
}
