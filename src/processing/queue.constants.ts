import { JobsOptions } from 'bullmq';

export const WEBHOOK_EVENTS_QUEUE_NAME = 'webhook-events';
export const PROCESS_WEBHOOK_EVENT_JOB_NAME = 'process-webhook-event';

export type ProcessWebhookEventJobData = {
  webhookEventId: string;
};

export const WEBHOOK_EVENTS_QUEUE = Symbol('WEBHOOK_EVENTS_QUEUE');

export const PROCESS_WEBHOOK_EVENT_JOB_OPTIONS: JobsOptions = {
  attempts: 5,
  backoff: {
    type: 'exponential',
    delay: 5_000,
  },
  removeOnComplete: {
    age: 3_600,
    count: 1_000,
  },
  removeOnFail: false,
};
