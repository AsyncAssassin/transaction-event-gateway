import type { TestingModule } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import type { DataSource } from 'typeorm';

// Exercises the automatic bridge accept -> outbox -> dispatcher runner -> BullMQ
// -> worker, without directly calling dispatchBatch() or queue.add(). The rest
// of the e2e suite keeps OUTBOX_DISPATCH_ENABLED=false. ConfigModule.forRoot()
// validates process.env at import time, so the runner must be enabled before
// WorkerModule is (re-)imported: reset the registry, set env, dynamically
// import, and restore the previous values afterwards.
describe('Outbox dispatcher runner (e2e)', () => {
  let moduleRef: TestingModule;
  let dataSource: DataSource;
  let previousEnabled: string | undefined;
  let previousInterval: string | undefined;

  beforeAll(async () => {
    previousEnabled = process.env.OUTBOX_DISPATCH_ENABLED;
    previousInterval = process.env.OUTBOX_DISPATCH_INTERVAL_MS;
    process.env.OUTBOX_DISPATCH_ENABLED = 'true';
    process.env.OUTBOX_DISPATCH_INTERVAL_MS = '200';

    jest.resetModules();
    const { Test } = await import('@nestjs/testing');
    const { DataSource: DataSourceCtor } = await import('typeorm');
    const { WorkerModule } = await import('../src/processing/worker.module');

    moduleRef = await Test.createTestingModule({
      imports: [WorkerModule],
    }).compile();
    await moduleRef.init();

    dataSource = moduleRef.get(DataSourceCtor);
  });

  beforeEach(async () => {
    await truncateProcessingTables(dataSource);
  });

  afterAll(async () => {
    await truncateProcessingTables(dataSource);
    await moduleRef.close();
    restoreEnv('OUTBOX_DISPATCH_ENABLED', previousEnabled);
    restoreEnv('OUTBOX_DISPATCH_INTERVAL_MS', previousInterval);
  });

  it('auto-publishes a pending outbox row and drives the webhook to PROCESSED', async () => {
    const paymentIntentId = randomUUID();
    const webhookEventId = randomUUID();
    const txHash = '0xrunner-auto';

    await dataSource.query(
      `
        INSERT INTO payment_intents (id, status, amount, asset, destination, reference, metadata)
        VALUES ($1, 'CREATED', '125.50', 'USDC', 'wallet_test_123', 'order-1001', '{}'::jsonb)
      `,
      [paymentIntentId],
    );

    await dataSource.query(
      `
        INSERT INTO webhook_events (
          id, provider, external_event_id, nonce, event_type,
          payment_intent_id, tx_hash, payload, payload_hash, status, received_at
        )
        VALUES ($1, 'blockchain', $2, $3, 'transaction.confirmed', $4, $5, $6::jsonb, $7, 'RECEIVED', now())
      `,
      [
        webhookEventId,
        `evt_${webhookEventId}`,
        `nonce_${webhookEventId}`,
        paymentIntentId,
        txHash,
        JSON.stringify({
          eventId: `evt_${webhookEventId}`,
          type: 'transaction.confirmed',
          paymentIntentId,
          txHash,
          amount: '125.50',
          asset: 'USDC',
        }),
        `hash_${webhookEventId}`,
      ],
    );

    // Only an inbox + outbox row exist. The dispatcher runner must publish the
    // job on its own and the worker must process it end to end.
    await dataSource.query(
      `
        INSERT INTO outbox_events (id, type, aggregate_type, aggregate_id, payload, status)
        VALUES ($1, 'process-webhook-event', 'webhook_event', $2, $3::jsonb, 'PENDING')
      `,
      [randomUUID(), webhookEventId, JSON.stringify({ webhookEventId })],
    );

    await waitFor(async () => {
      const rows = (await dataSource.query(
        `
          SELECT pi.status AS "paymentStatus", we.status AS "webhookStatus", oe.status AS "outboxStatus"
          FROM payment_intents pi
          JOIN webhook_events we ON we.payment_intent_id = pi.id
          JOIN outbox_events oe ON oe.aggregate_id = we.id
          WHERE we.id = $1
        `,
        [webhookEventId],
      )) as Array<{
        paymentStatus: string;
        webhookStatus: string;
        outboxStatus: string;
      }>;

      expect(rows).toEqual([
        {
          paymentStatus: 'CONFIRMED',
          webhookStatus: 'PROCESSED',
          outboxStatus: 'PUBLISHED',
        },
      ]);
    });
  }, 20_000);
});

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
}

async function waitFor(assertion: () => Promise<void>): Promise<void> {
  const deadline = Date.now() + 10_000;
  let lastError: unknown;

  while (Date.now() < deadline) {
    try {
      await assertion();
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  throw lastError;
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
