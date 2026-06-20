import { Test, TestingModule } from '@nestjs/testing';
import { Queue } from 'bullmq';
import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';

import { AppConfigModule } from '../src/config/config.module';
import { DatabaseModule } from '../src/database/database.module';
import { OutboxDispatcherService } from '../src/outbox/outbox-dispatcher.service';
import { OutboxModule } from '../src/outbox/outbox.module';
import {
  ProcessWebhookEventJobData,
  PROCESS_WEBHOOK_EVENT_JOB_NAME,
  WEBHOOK_EVENTS_QUEUE,
} from '../src/processing/queue.constants';
import { WebhookEventJobPublisher } from '../src/processing/webhook-event-job-publisher.service';

describe('Outbox dispatcher (e2e)', () => {
  let moduleRef: TestingModule;
  let dataSource: DataSource;
  let dispatcher: OutboxDispatcherService;
  let queue: Queue<ProcessWebhookEventJobData>;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [AppConfigModule, DatabaseModule, OutboxModule],
    }).compile();
    await moduleRef.init();

    dataSource = moduleRef.get(DataSource);
    dispatcher = moduleRef.get(OutboxDispatcherService);
    queue = moduleRef.get(WEBHOOK_EVENTS_QUEUE);
  });

  beforeEach(async () => {
    await cleanQueue(queue);
    await truncateProcessingTables(dataSource);
  });

  afterAll(async () => {
    await truncateProcessingTables(dataSource);
    await cleanQueue(queue);
    await moduleRef.close();
  });

  it('publishes a webhook job, marks outbox PUBLISHED, and queues the webhook event', async () => {
    const webhookEventId = await insertWebhookEvent(dataSource);
    const outboxEventId = await insertOutboxEvent(dataSource, webhookEventId);

    await expect(dispatcher.dispatchBatch()).resolves.toEqual({
      selected: 1,
      published: 1,
      failed: 0,
    });

    const outboxRows = (await dataSource.query(
      `
        SELECT
          status,
          attempts,
          last_error AS "lastError",
          next_attempt_at AS "nextAttemptAt",
          published_at AS "publishedAt"
        FROM outbox_events
        WHERE id = $1
      `,
      [outboxEventId],
    )) as Array<{
      status: string;
      attempts: number;
      lastError: string | null;
      nextAttemptAt: Date | null;
      publishedAt: Date | null;
    }>;

    expect(outboxRows).toEqual([
      expect.objectContaining({
        status: 'PUBLISHED',
        attempts: 0,
        lastError: null,
        nextAttemptAt: null,
      }),
    ]);
    expect(outboxRows[0]?.publishedAt).toBeInstanceOf(Date);
    await expectWebhookStatus(dataSource, webhookEventId, 'QUEUED');

    const jobs = await queue.getJobs(['waiting', 'delayed', 'completed', 'failed']);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.name).toBe(PROCESS_WEBHOOK_EVENT_JOB_NAME);
    expect(jobs[0]?.data).toEqual({ webhookEventId });
    expect(jobs[0]?.opts).toMatchObject({
      attempts: 5,
      backoff: {
        type: 'exponential',
        delay: 5_000,
      },
      removeOnFail: false,
    });
  });

  it('records retry metadata when publishing fails', async () => {
    const webhookEventId = await insertWebhookEvent(dataSource);
    const outboxEventId = await insertOutboxEvent(dataSource, webhookEventId);
    const failingPublisher = {
      publishProcessWebhookEvent: jest
        .fn()
        .mockRejectedValue(new Error('redis publish failed\nwith details')),
    };
    const failingDispatcher = new OutboxDispatcherService(
      dataSource,
      failingPublisher as unknown as WebhookEventJobPublisher,
    );
    const beforeDispatch = Date.now();

    await expect(failingDispatcher.dispatchBatch()).resolves.toEqual({
      selected: 1,
      published: 0,
      failed: 1,
    });
    expect(failingPublisher.publishProcessWebhookEvent).toHaveBeenCalledWith(
      webhookEventId,
    );

    const rows = (await dataSource.query(
      `
        SELECT
          status,
          attempts,
          last_error AS "lastError",
          next_attempt_at AS "nextAttemptAt",
          published_at AS "publishedAt"
        FROM outbox_events
        WHERE id = $1
      `,
      [outboxEventId],
    )) as Array<{
      status: string;
      attempts: number;
      lastError: string | null;
      nextAttemptAt: Date | null;
      publishedAt: Date | null;
    }>;

    expect(rows).toEqual([
      expect.objectContaining({
        status: 'FAILED',
        attempts: 1,
        lastError: 'redis publish failed with details',
        publishedAt: null,
      }),
    ]);
    expect(rows[0]?.nextAttemptAt).toBeInstanceOf(Date);
    expect(rows[0]?.nextAttemptAt?.getTime()).toBeGreaterThanOrEqual(
      beforeDispatch + 4_000,
    );
    await expectWebhookStatus(dataSource, webhookEventId, 'RECEIVED');
  });
});

async function insertWebhookEvent(dataSource: DataSource): Promise<string> {
  const webhookEventId = randomUUID();
  const paymentIntentId = randomUUID();
  const payload = {
    eventId: `evt_${webhookEventId}`,
    type: 'transaction.confirmed',
    paymentIntentId,
    txHash: `0x${webhookEventId.replace(/-/g, '')}`,
    amount: '125.50',
    asset: 'USDC',
  };

  await dataSource.query(
    `
      INSERT INTO webhook_events (
        id,
        provider,
        external_event_id,
        nonce,
        event_type,
        payment_intent_id,
        tx_hash,
        payload,
        payload_hash,
        status,
        received_at
      )
      VALUES (
        $1,
        'blockchain',
        $2,
        $3,
        'transaction.confirmed',
        $4,
        $5,
        $6::jsonb,
        $7,
        'RECEIVED',
        now()
      )
    `,
    [
      webhookEventId,
      payload.eventId,
      `nonce_${webhookEventId}`,
      paymentIntentId,
      payload.txHash,
      JSON.stringify(payload),
      `hash_${webhookEventId}`,
    ],
  );

  return webhookEventId;
}

async function insertOutboxEvent(
  dataSource: DataSource,
  webhookEventId: string,
): Promise<string> {
  const outboxEventId = randomUUID();

  await dataSource.query(
    `
      INSERT INTO outbox_events (
        id,
        type,
        aggregate_type,
        aggregate_id,
        payload,
        status
      )
      VALUES (
        $1,
        'process-webhook-event',
        'webhook_event',
        $2,
        $3::jsonb,
        'PENDING'
      )
    `,
    [
      outboxEventId,
      webhookEventId,
      JSON.stringify({ webhookEventId }),
    ],
  );

  return outboxEventId;
}

async function truncateProcessingTables(dataSource: DataSource): Promise<void> {
  await dataSource.query(
    `
      TRUNCATE TABLE
        webhook_processing_attempts,
        outbox_events,
        webhook_events,
        payment_intents,
        idempotency_records
      RESTART IDENTITY CASCADE
    `,
  );
}

async function expectWebhookStatus(
  dataSource: DataSource,
  webhookEventId: string,
  expectedStatus: string,
): Promise<void> {
  const rows = (await dataSource.query(
    'SELECT status FROM webhook_events WHERE id = $1',
    [webhookEventId],
  )) as Array<{ status: string }>;

  expect(rows).toEqual([{ status: expectedStatus }]);
}

async function cleanQueue(queue: Queue<ProcessWebhookEventJobData>): Promise<void> {
  await queue.obliterate({ force: true });
}
