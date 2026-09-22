import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';

import {
  ProcessWebhookEventJobData,
  PROCESS_WEBHOOK_EVENT_JOB_NAME,
  PROCESS_WEBHOOK_EVENT_JOB_OPTIONS,
  WEBHOOK_EVENTS_QUEUE_NAME,
} from './queue.constants';
import {
  WebhookEventsQueueFactory,
  WebhookEventsQueueHolder,
} from './webhook-events-queue-holder.service';

type QueueMock = {
  add: jest.Mock<
    Promise<unknown>,
    [
      string,
      ProcessWebhookEventJobData,
      typeof PROCESS_WEBHOOK_EVENT_JOB_OPTIONS,
    ]
  >;
  close: jest.Mock<Promise<void>, []>;
  on: jest.Mock<QueueMock, [string, (error: Error) => void]>;
  emitError: (error: Error) => void;
};

describe('WebhookEventsQueueHolder', () => {
  const redisUrl = 'redis://localhost:6379';
  let queueFactory: jest.MockedFunction<WebhookEventsQueueFactory>;
  let holder: WebhookEventsQueueHolder;

  beforeEach(() => {
    queueFactory = jest.fn();
    holder = new WebhookEventsQueueHolder(
      {
        getOrThrow: jest.fn((key: string) =>
          key === 'REDIS_URL' ? redisUrl : undefined,
        ),
      } as unknown as ConfigService,
      queueFactory,
    );
  });

  it('adds the process-webhook-event job with expected data and options', async () => {
    const queue = createQueueMock();
    queueFactory.mockReturnValueOnce(
      queue as unknown as Queue<ProcessWebhookEventJobData>,
    );

    await holder.addProcessWebhookEvent('webhook-event-1');

    expect(queue.add).toHaveBeenCalledWith(
      PROCESS_WEBHOOK_EVENT_JOB_NAME,
      { webhookEventId: 'webhook-event-1' },
      PROCESS_WEBHOOK_EVENT_JOB_OPTIONS,
    );
  });

  it('creates Queue with fail-fast publisher options', async () => {
    const queue = createQueueMock();
    queueFactory.mockReturnValueOnce(
      queue as unknown as Queue<ProcessWebhookEventJobData>,
    );

    await holder.addProcessWebhookEvent('webhook-event-1');

    expect(queueFactory).toHaveBeenCalledWith(
      WEBHOOK_EVENTS_QUEUE_NAME,
      expect.objectContaining({
        connection: {
          url: redisUrl,
          connectTimeout: 2_000,
          maxRetriesPerRequest: 1,
        },
        defaultJobOptions: PROCESS_WEBHOOK_EVENT_JOB_OPTIONS,
        skipWaitingForReady: true,
      }),
    );
  });

  it('recreates the queue and retries once when the first add rejects', async () => {
    const firstQueue = createQueueMock({
      add: jest.fn().mockRejectedValue(new Error('cached rejected client')),
    });
    const secondQueue = createQueueMock();
    queueFactory
      .mockReturnValueOnce(
        firstQueue as unknown as Queue<ProcessWebhookEventJobData>,
      )
      .mockReturnValueOnce(
        secondQueue as unknown as Queue<ProcessWebhookEventJobData>,
      );

    await expect(
      holder.addProcessWebhookEvent('webhook-event-1'),
    ).resolves.toBeUndefined();

    expect(firstQueue.add).toHaveBeenCalledTimes(1);
    expect(secondQueue.add).toHaveBeenCalledWith(
      PROCESS_WEBHOOK_EVENT_JOB_NAME,
      { webhookEventId: 'webhook-event-1' },
      PROCESS_WEBHOOK_EVENT_JOB_OPTIONS,
    );
    expect(firstQueue.close).toHaveBeenCalledTimes(1);
  });

  it('throws when the recreated queue also fails', async () => {
    const firstQueue = createQueueMock({
      add: jest.fn().mockRejectedValue(new Error('cached rejected client')),
    });
    const secondQueue = createQueueMock({
      add: jest.fn().mockRejectedValue(new Error('redis still down')),
    });
    queueFactory
      .mockReturnValueOnce(
        firstQueue as unknown as Queue<ProcessWebhookEventJobData>,
      )
      .mockReturnValueOnce(
        secondQueue as unknown as Queue<ProcessWebhookEventJobData>,
      );

    await expect(
      holder.addProcessWebhookEvent('webhook-event-1'),
    ).rejects.toThrow('redis still down');

    expect(firstQueue.close).toHaveBeenCalledTimes(1);
    expect(secondQueue.add).toHaveBeenCalledTimes(1);
  });

  it('recreates a queue that was marked poisoned by an error event', async () => {
    const firstQueue = createQueueMock();
    const secondQueue = createQueueMock();
    queueFactory
      .mockReturnValueOnce(
        firstQueue as unknown as Queue<ProcessWebhookEventJobData>,
      )
      .mockReturnValueOnce(
        secondQueue as unknown as Queue<ProcessWebhookEventJobData>,
      );

    holder.getQueue();
    firstQueue.emitError(new Error('init rejected'));
    await holder.addProcessWebhookEvent('webhook-event-1');

    expect(firstQueue.close).toHaveBeenCalledTimes(1);
    expect(firstQueue.add).not.toHaveBeenCalled();
    expect(secondQueue.add).toHaveBeenCalledTimes(1);
  });

  it('closes the active queue on module destroy', async () => {
    const queue = createQueueMock();
    queueFactory.mockReturnValueOnce(
      queue as unknown as Queue<ProcessWebhookEventJobData>,
    );

    holder.getQueue();
    await holder.onModuleDestroy();

    expect(queue.close).toHaveBeenCalledTimes(1);
  });
});

function createQueueMock(overrides: Partial<QueueMock> = {}): QueueMock {
  let errorHandler: ((error: Error) => void) | undefined;
  const queue: QueueMock = {
    add: jest.fn().mockResolvedValue({ id: 'job-1' }),
    close: jest.fn().mockResolvedValue(undefined),
    on: jest.fn().mockImplementation((event, handler) => {
      if (event === 'error') {
        errorHandler = handler;
      }

      return queue;
    }),
    emitError: (error: Error) => errorHandler?.(error),
    ...overrides,
  };

  return queue;
}
