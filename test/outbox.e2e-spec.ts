import { Test, TestingModule } from '@nestjs/testing';
import { Queue } from 'bullmq';
import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';

import { AppConfigModule } from '../src/config/config.module';
import { DatabaseModule } from '../src/database/database.module';
import {
  DEFAULT_STALE_PUBLISHED_AFTER_MS,
  OutboxDispatcherService,
} from '../src/outbox/outbox-dispatcher.service';
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

    const jobs = await queue.getJobs([
      'waiting',
      'delayed',
      'completed',
      'failed',
    ]);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.name).toBe(PROCESS_WEBHOOK_EVENT_JOB_NAME);
    expect(jobs[0]?.data).toEqual({ webhookEventId });
    expect(jobs[0]?.opts).toMatchObject({
      attempts: 5,
      backoff: {
        type: 'exponential',
        delay: 5_000,
      },
      removeOnFail: {
        age: 7 * 24 * 3_600,
        count: 5_000,
      },
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
          dead_at AS "deadAt",
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
      deadAt: Date | null;
      lastError: string | null;
      nextAttemptAt: Date | null;
      publishedAt: Date | null;
    }>;

    expect(rows).toEqual([
      expect.objectContaining({
        status: 'FAILED',
        attempts: 1,
        deadAt: null,
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

  it('keeps transient publish failures retryable after the old max-attempt threshold', async () => {
    const webhookEventId = await insertWebhookEvent(dataSource);
    const outboxEventId = await insertRetryableFailedOutboxEvent(
      dataSource,
      webhookEventId,
      9,
    );
    const failingPublisher = {
      publishProcessWebhookEvent: jest
        .fn()
        .mockRejectedValue(new Error('redis publish failed')),
    };
    const failingDispatcher = new OutboxDispatcherService(
      dataSource,
      failingPublisher as unknown as WebhookEventJobPublisher,
    );

    await expect(failingDispatcher.dispatchBatch()).resolves.toEqual({
      selected: 1,
      published: 0,
      failed: 1,
    });

    const rows = (await dataSource.query(
      `
        SELECT
          status,
          attempts,
          dead_at AS "deadAt",
          last_error AS "lastError",
          next_attempt_at AS "nextAttemptAt"
        FROM outbox_events
        WHERE id = $1
      `,
      [outboxEventId],
    )) as Array<{
      status: string;
      attempts: number;
      deadAt: Date | null;
      lastError: string | null;
      nextAttemptAt: Date | null;
    }>;

    expect(rows[0]?.status).toBe('FAILED');
    expect(rows[0]?.attempts).toBe(10);
    expect(rows[0]?.deadAt).toBeNull();
    expect(rows[0]?.lastError).toBe('redis publish failed');
    expect(rows[0]?.nextAttemptAt).toBeInstanceOf(Date);

    // The retry is delayed, not terminalized.
    await expect(failingDispatcher.dispatchBatch()).resolves.toEqual({
      selected: 0,
      published: 0,
      failed: 0,
    });
    expect(failingPublisher.publishProcessWebhookEvent).toHaveBeenCalledTimes(
      1,
    );
  });

  it('dead-letters a deterministic poison outbox payload without publishing', async () => {
    const webhookEventId = await insertWebhookEvent(dataSource);
    const outboxEventId = await insertOutboxEvent(dataSource, webhookEventId, {
      webhookEventId: 42,
    });
    const publisher = {
      publishProcessWebhookEvent: jest.fn().mockResolvedValue(undefined),
    };
    const poisonDispatcher = new OutboxDispatcherService(
      dataSource,
      publisher as unknown as WebhookEventJobPublisher,
    );

    await expect(poisonDispatcher.dispatchBatch()).resolves.toEqual({
      selected: 1,
      published: 0,
      failed: 1,
    });
    expect(publisher.publishProcessWebhookEvent).not.toHaveBeenCalled();

    const rows = (await dataSource.query(
      `
        SELECT
          status,
          attempts,
          dead_at AS "deadAt",
          last_error AS "lastError",
          next_attempt_at AS "nextAttemptAt"
        FROM outbox_events
        WHERE id = $1
      `,
      [outboxEventId],
    )) as Array<{
      status: string;
      attempts: number;
      deadAt: Date | null;
      lastError: string | null;
      nextAttemptAt: Date | null;
    }>;

    expect(rows[0]?.status).toBe('FAILED');
    expect(rows[0]?.attempts).toBe(1);
    expect(rows[0]?.deadAt).toBeInstanceOf(Date);
    expect(rows[0]?.lastError).toBe('INVALID_OUTBOX_PAYLOAD');
    expect(rows[0]?.nextAttemptAt).toBeNull();

    await expect(poisonDispatcher.dispatchBatch()).resolves.toEqual({
      selected: 0,
      published: 0,
      failed: 0,
    });
  });

  it('publishes after transient failures once the retry becomes due', async () => {
    const webhookEventId = await insertWebhookEvent(dataSource);
    const outboxEventId = await insertOutboxEvent(dataSource, webhookEventId);
    const publisher = {
      publishProcessWebhookEvent: jest
        .fn()
        .mockRejectedValueOnce(new Error('redis temporarily unavailable'))
        .mockResolvedValueOnce(undefined),
    };
    const recoveringDispatcher = new OutboxDispatcherService(
      dataSource,
      publisher as unknown as WebhookEventJobPublisher,
    );

    await expect(recoveringDispatcher.dispatchBatch()).resolves.toEqual({
      selected: 1,
      published: 0,
      failed: 1,
    });

    await dataSource.query(
      `
        UPDATE outbox_events
        SET next_attempt_at = now() - interval '1 minute'
        WHERE id = $1
      `,
      [outboxEventId],
    );

    await expect(recoveringDispatcher.dispatchBatch()).resolves.toEqual({
      selected: 1,
      published: 1,
      failed: 0,
    });
    expect(publisher.publishProcessWebhookEvent).toHaveBeenCalledTimes(2);
    expect(publisher.publishProcessWebhookEvent).toHaveBeenNthCalledWith(
      2,
      webhookEventId,
    );

    const rows = (await dataSource.query(
      `
        SELECT
          status,
          attempts,
          dead_at AS "deadAt",
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
      deadAt: Date | null;
      lastError: string | null;
      nextAttemptAt: Date | null;
      publishedAt: Date | null;
    }>;

    expect(rows).toEqual([
      expect.objectContaining({
        status: 'PUBLISHED',
        attempts: 1,
        deadAt: null,
        lastError: null,
        nextAttemptAt: null,
      }),
    ]);
    expect(rows[0]?.publishedAt).toBeInstanceOf(Date);
    await expectWebhookStatus(dataSource, webhookEventId, 'QUEUED');
  });

  it('hands stale PUBLISHED rows of unfinished webhook events back to the dispatcher', async () => {
    const queuedWebhookEventId = await insertWebhookEvent(dataSource, 'QUEUED');
    const receivedWebhookEventId = await insertWebhookEvent(
      dataSource,
      'RECEIVED',
    );
    const outboxEventIds = [
      await insertPublishedOutboxEvent(
        dataSource,
        queuedWebhookEventId,
        '11 minutes',
      ),
      await insertPublishedOutboxEvent(
        dataSource,
        receivedWebhookEventId,
        '11 minutes',
      ),
    ];

    // No BullMQ job exists for either event, as after a Redis data loss or
    // after the job exhausted its attempts.
    await expect(dispatcher.reconcileStalePublishedEvents()).resolves.toEqual({
      requeued: 2,
    });

    const requeuedRows = (await dataSource.query(
      `
        SELECT
          status,
          attempts,
          dead_at AS "deadAt",
          last_error AS "lastError",
          next_attempt_at <= now() AS "due"
        FROM outbox_events
        WHERE id = ANY($1::uuid[])
      `,
      [outboxEventIds],
    )) as Array<Record<string, unknown>>;

    expect(requeuedRows).toEqual([
      {
        status: 'FAILED',
        attempts: 0,
        deadAt: null,
        lastError: 'STALE_PUBLISHED_WEBHOOK_REQUEUED',
        due: true,
      },
      {
        status: 'FAILED',
        attempts: 0,
        deadAt: null,
        lastError: 'STALE_PUBLISHED_WEBHOOK_REQUEUED',
        due: true,
      },
    ]);

    await expect(dispatcher.dispatchBatch()).resolves.toEqual({
      selected: 2,
      published: 2,
      failed: 0,
    });

    const republishedRows = (await dataSource.query(
      `
        SELECT
          status,
          last_error AS "lastError",
          published_at > now() - interval '1 minute' AS "freshlyPublished"
        FROM outbox_events
        WHERE id = ANY($1::uuid[])
      `,
      [outboxEventIds],
    )) as Array<Record<string, unknown>>;

    expect(republishedRows).toEqual([
      { status: 'PUBLISHED', lastError: null, freshlyPublished: true },
      { status: 'PUBLISHED', lastError: null, freshlyPublished: true },
    ]);
    await expectWebhookStatus(dataSource, queuedWebhookEventId, 'QUEUED');
    await expectWebhookStatus(dataSource, receivedWebhookEventId, 'QUEUED');

    const jobs = await queue.getJobs(['waiting', 'delayed']);
    expect(jobs.map((job) => job.data.webhookEventId).sort()).toEqual(
      [queuedWebhookEventId, receivedWebhookEventId].sort(),
    );
  });

  it('leaves recently published, finished, and unpublished outbox rows alone', async () => {
    const recentWebhookEventId = await insertWebhookEvent(dataSource, 'QUEUED');
    await insertPublishedOutboxEvent(
      dataSource,
      recentWebhookEventId,
      '1 minute',
    );
    const processedWebhookEventId = await insertWebhookEvent(
      dataSource,
      'PROCESSED',
    );
    await insertPublishedOutboxEvent(
      dataSource,
      processedWebhookEventId,
      '11 minutes',
    );
    const failedWebhookEventId = await insertWebhookEvent(dataSource, 'FAILED');
    await insertPublishedOutboxEvent(
      dataSource,
      failedWebhookEventId,
      '11 minutes',
    );
    const pendingWebhookEventId = await insertWebhookEvent(dataSource);
    await insertOutboxEvent(dataSource, pendingWebhookEventId);

    await expect(dispatcher.reconcileStalePublishedEvents()).resolves.toEqual({
      requeued: 0,
    });

    const rows = (await dataSource.query(
      `
        SELECT status, count(*)::int AS "count"
        FROM outbox_events
        WHERE last_error IS NULL
        GROUP BY status
        ORDER BY status
      `,
    )) as Array<{ status: string; count: number }>;

    expect(rows).toEqual([
      { status: 'PENDING', count: 1 },
      { status: 'PUBLISHED', count: 3 },
    ]);
  });

  it('requeues at most the batch size per run and never the same row twice across concurrent runs', async () => {
    const webhookEventIds: string[] = [];
    for (let index = 0; index < 5; index += 1) {
      const webhookEventId = await insertWebhookEvent(dataSource, 'QUEUED');
      await insertPublishedOutboxEvent(
        dataSource,
        webhookEventId,
        '11 minutes',
      );
      webhookEventIds.push(webhookEventId);
    }

    await expect(
      dispatcher.reconcileStalePublishedEvents(
        DEFAULT_STALE_PUBLISHED_AFTER_MS,
        2,
      ),
    ).resolves.toEqual({ requeued: 2 });

    const concurrentRuns = await Promise.all([
      dispatcher.reconcileStalePublishedEvents(),
      dispatcher.reconcileStalePublishedEvents(),
    ]);
    expect(concurrentRuns.reduce((total, run) => total + run.requeued, 0)).toBe(
      3,
    );

    const rows = (await dataSource.query(
      `
        SELECT status, count(*)::int AS "count"
        FROM outbox_events
        WHERE aggregate_id = ANY($1::uuid[])
        GROUP BY status
      `,
      [webhookEventIds],
    )) as Array<{ status: string; count: number }>;

    expect(rows).toEqual([{ status: 'FAILED', count: 5 }]);
  });
});

async function insertRetryableFailedOutboxEvent(
  dataSource: DataSource,
  webhookEventId: string,
  attempts: number,
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
        status,
        attempts,
        next_attempt_at
      )
      VALUES (
        $1,
        'process-webhook-event',
        'webhook_event',
        $2,
        $3::jsonb,
        'FAILED',
        $4,
        now() - interval '1 minute'
      )
    `,
    [
      outboxEventId,
      webhookEventId,
      JSON.stringify({ webhookEventId }),
      attempts,
    ],
  );

  return outboxEventId;
}

async function insertWebhookEvent(
  dataSource: DataSource,
  status = 'RECEIVED',
): Promise<string> {
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
        $8,
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
      status,
    ],
  );

  return webhookEventId;
}

async function insertOutboxEvent(
  dataSource: DataSource,
  webhookEventId: string,
  payload: Record<string, unknown> = { webhookEventId },
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
    [outboxEventId, webhookEventId, JSON.stringify(payload)],
  );

  return outboxEventId;
}

async function insertPublishedOutboxEvent(
  dataSource: DataSource,
  webhookEventId: string,
  publishedAgo: string,
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
        status,
        published_at
      )
      VALUES (
        $1,
        'process-webhook-event',
        'webhook_event',
        $2,
        $3::jsonb,
        'PUBLISHED',
        now() - $4::interval
      )
    `,
    [
      outboxEventId,
      webhookEventId,
      JSON.stringify({ webhookEventId }),
      publishedAgo,
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

async function cleanQueue(
  queue: Queue<ProcessWebhookEventJobData>,
): Promise<void> {
  await queue.obliterate({ force: true });
}
