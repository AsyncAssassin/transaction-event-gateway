import { Test, TestingModule } from '@nestjs/testing';
import { Queue } from 'bullmq';
import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';

import {
  ProcessWebhookEventJobData,
  PROCESS_WEBHOOK_EVENT_JOB_NAME,
  PROCESS_WEBHOOK_EVENT_JOB_OPTIONS,
  WEBHOOK_EVENTS_QUEUE,
} from '../src/processing/queue.constants';
import { WorkerModule } from '../src/processing/worker.module';

describe('Webhook BullMQ worker (e2e)', () => {
  let moduleRef: TestingModule;
  let dataSource: DataSource;
  let queue: Queue<ProcessWebhookEventJobData>;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [WorkerModule],
    }).compile();
    await moduleRef.init();

    dataSource = moduleRef.get(DataSource);
    queue = moduleRef.get(WEBHOOK_EVENTS_QUEUE);
  });

  beforeEach(async () => {
    await queue.obliterate({ force: true });
    await truncateProcessingTables(dataSource);
  });

  afterAll(async () => {
    await truncateProcessingTables(dataSource);
    await queue.obliterate({ force: true });
    await moduleRef.close();
  });

  it('consumes a BullMQ process-webhook-event job using durable database state', async () => {
    const paymentIntentId = randomUUID();
    const webhookEventId = randomUUID();
    const txHash = '0xbullmq-worker';

    await dataSource.query(
      `
        INSERT INTO payment_intents (
          id,
          status,
          amount,
          asset,
          destination,
          reference,
          metadata
        )
        VALUES (
          $1,
          'CREATED',
          '125.50',
          'USDC',
          'wallet_test_123',
          'order-1001',
          '{}'::jsonb
        )
      `,
      [paymentIntentId],
    );

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

    await queue.add(
      PROCESS_WEBHOOK_EVENT_JOB_NAME,
      { webhookEventId },
      PROCESS_WEBHOOK_EVENT_JOB_OPTIONS,
    );

    await waitFor(async () => {
      const rows = (await dataSource.query(
        `
          SELECT
            pi.status AS "paymentStatus",
            pi.confirmed_tx_hash AS "confirmedTxHash",
            we.status AS "webhookStatus"
          FROM payment_intents pi
          JOIN webhook_events we ON we.payment_intent_id = pi.id
          WHERE we.id = $1
        `,
        [webhookEventId],
      )) as Array<{
        paymentStatus: string;
        confirmedTxHash: string | null;
        webhookStatus: string;
      }>;

      expect(rows).toEqual([
        {
          paymentStatus: 'CONFIRMED',
          confirmedTxHash: txHash,
          webhookStatus: 'PROCESSED',
        },
      ]);
    });
  });
});

async function waitFor(assertion: () => Promise<void>): Promise<void> {
  const deadline = Date.now() + 5_000;
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
