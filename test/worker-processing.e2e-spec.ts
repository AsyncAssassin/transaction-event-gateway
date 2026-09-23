import { Test, TestingModule } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import { DataSource, EntityManager } from 'typeorm';

import { AppConfigModule } from '../src/config/config.module';
import { DatabaseModule } from '../src/database/database.module';
import { PaymentIntentStatus } from '../src/database/entities';
import { ProcessingModule } from '../src/processing/processing.module';
import { WebhookEventProcessorService } from '../src/processing/webhook-event-processor.service';

describe('Webhook event processor (e2e)', () => {
  let moduleRef: TestingModule;
  let dataSource: DataSource;
  let processor: WebhookEventProcessorService;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [AppConfigModule, DatabaseModule, ProcessingModule],
    }).compile();
    await moduleRef.init();

    dataSource = moduleRef.get(DataSource);
    processor = moduleRef.get(WebhookEventProcessorService);
  });

  beforeEach(async () => {
    await truncateProcessingTables(dataSource);
  });

  afterAll(async () => {
    await truncateProcessingTables(dataSource);
    await moduleRef.close();
  });

  it('processes a matching confirmed webhook and updates the payment intent', async () => {
    const paymentIntentId = await insertPaymentIntent(dataSource);
    const webhookEventId = await insertWebhookEvent(dataSource, {
      paymentIntentId,
      txHash: '0xmatching',
    });

    await expect(
      processor.processWebhookEvent({ webhookEventId, jobId: 'job-success' }),
    ).resolves.toEqual({ status: 'processed' });

    await expectPaymentIntent(dataSource, paymentIntentId, {
      status: 'CONFIRMED',
      confirmedTxHash: '0xmatching',
    });
    await expectWebhookEvent(dataSource, webhookEventId, {
      status: 'PROCESSED',
      failureReason: null,
    });
    await expectAttemptRows(dataSource, webhookEventId, [
      {
        jobId: 'job-success',
        status: 'SUCCEEDED',
        errorMessage: null,
      },
    ]);
  });

  it('processes the same webhook twice without duplicate payment side effects', async () => {
    const paymentIntentId = await insertPaymentIntent(dataSource);
    const webhookEventId = await insertWebhookEvent(dataSource, {
      paymentIntentId,
      txHash: '0xduplicate-safe',
    });

    await processor.processWebhookEvent({ webhookEventId, jobId: 'job-first' });
    await expect(
      processor.processWebhookEvent({ webhookEventId, jobId: 'job-second' }),
    ).resolves.toEqual({ status: 'already_processed' });

    await expectPaymentIntent(dataSource, paymentIntentId, {
      status: 'CONFIRMED',
      confirmedTxHash: '0xduplicate-safe',
    });
    await expectAttemptRows(dataSource, webhookEventId, [
      {
        jobId: 'job-first',
        status: 'SUCCEEDED',
        errorMessage: null,
      },
      {
        jobId: 'job-second',
        status: 'SUCCEEDED',
        errorMessage: null,
      },
    ]);
  });

  it('exits successfully when the webhook event is already PROCESSED', async () => {
    const webhookEventId = await insertWebhookEvent(dataSource, {
      status: 'PROCESSED',
    });

    await expect(
      processor.processWebhookEvent({
        webhookEventId,
        jobId: 'job-already-processed',
      }),
    ).resolves.toEqual({ status: 'already_processed' });

    await expectWebhookEvent(dataSource, webhookEventId, {
      status: 'PROCESSED',
      failureReason: null,
    });
    await expectAttemptRows(dataSource, webhookEventId, [
      {
        jobId: 'job-already-processed',
        status: 'SUCCEEDED',
        errorMessage: null,
      },
    ]);
  });

  it('marks unknown payment intents as FAILED with a sanitized reason', async () => {
    const webhookEventId = await insertWebhookEvent(dataSource, {
      paymentIntentId: randomUUID(),
      txHash: '0xunknown',
    });

    await expect(
      processor.processWebhookEvent({ webhookEventId, jobId: 'job-unknown' }),
    ).resolves.toEqual({
      status: 'failed',
      reason: 'UNKNOWN_PAYMENT_INTENT',
    });

    await expectWebhookEvent(dataSource, webhookEventId, {
      status: 'FAILED',
      failureReason: 'UNKNOWN_PAYMENT_INTENT',
    });
    await expectAttemptRows(dataSource, webhookEventId, [
      {
        jobId: 'job-unknown',
        status: 'FAILED',
        errorMessage: 'UNKNOWN_PAYMENT_INTENT',
      },
    ]);
  });

  it('keeps a FAILED event final when a later job arrives after its payment intent was created', async () => {
    const paymentIntentId = randomUUID();
    const webhookEventId = await insertWebhookEvent(dataSource, {
      paymentIntentId,
      txHash: '0xarrived-before-intent',
    });

    await expect(
      processor.processWebhookEvent({ webhookEventId, jobId: 'job-first' }),
    ).resolves.toEqual({ status: 'failed', reason: 'UNKNOWN_PAYMENT_INTENT' });

    await insertPaymentIntent(dataSource, { id: paymentIntentId });

    await expect(
      processor.processWebhookEvent({ webhookEventId, jobId: 'job-duplicate' }),
    ).resolves.toEqual({
      status: 'already_failed',
      reason: 'UNKNOWN_PAYMENT_INTENT',
    });

    await expectPaymentIntent(dataSource, paymentIntentId, {
      status: 'CREATED',
      confirmedTxHash: null,
    });
    await expectWebhookEvent(dataSource, webhookEventId, {
      status: 'FAILED',
      failureReason: 'UNKNOWN_PAYMENT_INTENT',
    });
    await expectAttemptRows(dataSource, webhookEventId, [
      {
        jobId: 'job-first',
        status: 'FAILED',
        errorMessage: 'UNKNOWN_PAYMENT_INTENT',
      },
      {
        jobId: 'job-duplicate',
        status: 'FAILED',
        errorMessage: 'UNKNOWN_PAYMENT_INTENT',
      },
    ]);
  });

  it('marks amount mismatch as FAILED without mutating the payment intent', async () => {
    const paymentIntentId = await insertPaymentIntent(dataSource, {
      amount: '125.50',
    });
    const webhookEventId = await insertWebhookEvent(dataSource, {
      paymentIntentId,
      amount: '126.50',
      txHash: '0xamount-mismatch',
    });

    await expect(
      processor.processWebhookEvent({
        webhookEventId,
        jobId: 'job-amount-mismatch',
      }),
    ).resolves.toEqual({
      status: 'failed',
      reason: 'AMOUNT_MISMATCH',
    });

    await expectPaymentIntent(dataSource, paymentIntentId, {
      status: 'CREATED',
      confirmedTxHash: null,
    });
    await expectWebhookEvent(dataSource, webhookEventId, {
      status: 'FAILED',
      failureReason: 'AMOUNT_MISMATCH',
    });
  });

  it('marks asset mismatch as FAILED without mutating the payment intent', async () => {
    const paymentIntentId = await insertPaymentIntent(dataSource, {
      asset: 'USDC',
    });
    const webhookEventId = await insertWebhookEvent(dataSource, {
      paymentIntentId,
      asset: 'ETH',
      txHash: '0xasset-mismatch',
    });

    await expect(
      processor.processWebhookEvent({
        webhookEventId,
        jobId: 'job-asset-mismatch',
      }),
    ).resolves.toEqual({
      status: 'failed',
      reason: 'ASSET_MISMATCH',
    });

    await expectPaymentIntent(dataSource, paymentIntentId, {
      status: 'CREATED',
      confirmedTxHash: null,
    });
    await expectWebhookEvent(dataSource, webhookEventId, {
      status: 'FAILED',
      failureReason: 'ASSET_MISMATCH',
    });
  });

  it('does not overwrite terminal FAILED or EXPIRED payment intents', async () => {
    const failedPaymentIntentId = await insertPaymentIntent(dataSource, {
      status: PaymentIntentStatus.Failed,
    });
    const expiredPaymentIntentId = await insertPaymentIntent(dataSource, {
      status: PaymentIntentStatus.Expired,
    });
    const failedWebhookEventId = await insertWebhookEvent(dataSource, {
      paymentIntentId: failedPaymentIntentId,
      txHash: '0xfailed-terminal',
    });
    const expiredWebhookEventId = await insertWebhookEvent(dataSource, {
      paymentIntentId: expiredPaymentIntentId,
      txHash: '0xexpired-terminal',
    });

    await expect(
      processor.processWebhookEvent({
        webhookEventId: failedWebhookEventId,
        jobId: 'job-terminal-failed',
      }),
    ).resolves.toEqual({
      status: 'failed',
      reason: 'PAYMENT_INTENT_TERMINAL',
    });
    await expect(
      processor.processWebhookEvent({
        webhookEventId: expiredWebhookEventId,
        jobId: 'job-terminal-expired',
      }),
    ).resolves.toEqual({
      status: 'failed',
      reason: 'PAYMENT_INTENT_TERMINAL',
    });

    await expectPaymentIntent(dataSource, failedPaymentIntentId, {
      status: 'FAILED',
      confirmedTxHash: null,
    });
    await expectPaymentIntent(dataSource, expiredPaymentIntentId, {
      status: 'EXPIRED',
      confirmedTxHash: null,
    });
  });

  it('confirms a payment intent already in PROCESSING', async () => {
    const paymentIntentId = await insertPaymentIntent(dataSource, {
      status: PaymentIntentStatus.Processing,
    });
    const webhookEventId = await insertWebhookEvent(dataSource, {
      paymentIntentId,
      txHash: '0xprocessing-confirm',
    });

    await expect(
      processor.processWebhookEvent({
        webhookEventId,
        jobId: 'job-processing',
      }),
    ).resolves.toEqual({ status: 'processed' });

    await expectPaymentIntent(dataSource, paymentIntentId, {
      status: 'CONFIRMED',
      confirmedTxHash: '0xprocessing-confirm',
    });
  });

  it('marks an unsupported event type as FAILED without mutating the payment intent', async () => {
    const paymentIntentId = await insertPaymentIntent(dataSource);
    const webhookEventId = await insertWebhookEvent(dataSource, {
      paymentIntentId,
      type: 'transaction.reversed',
      txHash: '0xunsupported',
    });

    await expect(
      processor.processWebhookEvent({
        webhookEventId,
        jobId: 'job-unsupported',
      }),
    ).resolves.toEqual({ status: 'failed', reason: 'UNSUPPORTED_EVENT_TYPE' });

    await expectPaymentIntent(dataSource, paymentIntentId, {
      status: 'CREATED',
      confirmedTxHash: null,
    });
    await expectWebhookEvent(dataSource, webhookEventId, {
      status: 'FAILED',
      failureReason: 'UNSUPPORTED_EVENT_TYPE',
    });
  });

  it('marks a confirmed event without a transaction hash as FAILED without mutating the payment intent', async () => {
    const paymentIntentId = await insertPaymentIntent(dataSource);
    const webhookEventId = await insertWebhookEvent(dataSource, {
      paymentIntentId,
      txHash: null,
    });

    await expect(
      processor.processWebhookEvent({
        webhookEventId,
        jobId: 'job-missing-tx-hash',
      }),
    ).resolves.toEqual({ status: 'failed', reason: 'MISSING_TX_HASH' });

    await expectPaymentIntent(dataSource, paymentIntentId, {
      status: 'CREATED',
      confirmedTxHash: null,
    });
    await expectWebhookEvent(dataSource, webhookEventId, {
      status: 'FAILED',
      failureReason: 'MISSING_TX_HASH',
    });
    await expectAttemptRows(dataSource, webhookEventId, [
      {
        jobId: 'job-missing-tx-hash',
        status: 'FAILED',
        errorMessage: 'MISSING_TX_HASH',
      },
    ]);
  });

  it('fails when the transaction hash already confirms another payment intent', async () => {
    const sharedTxHash = '0xshared-confirmed';
    await insertPaymentIntent(dataSource, {
      status: PaymentIntentStatus.Confirmed,
      confirmedTxHash: sharedTxHash,
    });
    const targetPaymentIntentId = await insertPaymentIntent(dataSource);
    const webhookEventId = await insertWebhookEvent(dataSource, {
      paymentIntentId: targetPaymentIntentId,
      txHash: sharedTxHash,
    });

    await expect(
      processor.processWebhookEvent({ webhookEventId, jobId: 'job-conflict' }),
    ).resolves.toEqual({
      status: 'failed',
      reason: 'CONFIRMED_TX_HASH_CONFLICT',
    });

    await expectPaymentIntent(dataSource, targetPaymentIntentId, {
      status: 'CREATED',
      confirmedTxHash: null,
    });
    await expectWebhookEvent(dataSource, webhookEventId, {
      status: 'FAILED',
      failureReason: 'CONFIRMED_TX_HASH_CONFLICT',
    });
  });

  it('treats another spelling of a confirmed transaction hash as the same transaction', async () => {
    await insertPaymentIntent(dataSource, {
      status: PaymentIntentStatus.Confirmed,
      confirmedTxHash: '0xabcdef02',
    });
    const targetPaymentIntentId = await insertPaymentIntent(dataSource);
    // Stored before acceptance normalized hashes.
    const webhookEventId = await insertWebhookEvent(dataSource, {
      paymentIntentId: targetPaymentIntentId,
      txHash: ' 0xABCDEF02 ',
    });

    await expect(
      processor.processWebhookEvent({ webhookEventId, jobId: 'job-spelling' }),
    ).resolves.toEqual({
      status: 'failed',
      reason: 'CONFIRMED_TX_HASH_CONFLICT',
    });

    await expectPaymentIntent(dataSource, targetPaymentIntentId, {
      status: 'CREATED',
      confirmedTxHash: null,
    });
  });

  it('confirms with the canonical hash and accepts the same hash in another spelling later', async () => {
    const paymentIntentId = await insertPaymentIntent(dataSource);
    const firstWebhookEventId = await insertWebhookEvent(dataSource, {
      paymentIntentId,
      txHash: '0xABCDEF03',
    });
    const secondWebhookEventId = await insertWebhookEvent(dataSource, {
      paymentIntentId,
      txHash: ' 0xabcdef03 ',
    });

    await expect(
      processor.processWebhookEvent({ webhookEventId: firstWebhookEventId }),
    ).resolves.toEqual({ status: 'processed' });
    await expect(
      processor.processWebhookEvent({ webhookEventId: secondWebhookEventId }),
    ).resolves.toEqual({ status: 'processed' });

    await expectPaymentIntent(dataSource, paymentIntentId, {
      status: 'CONFIRMED',
      confirmedTxHash: '0xabcdef03',
    });
    await expectWebhookEvent(dataSource, secondWebhookEventId, {
      status: 'PROCESSED',
      failureReason: null,
    });
  });

  it('rolls back and leaves state unchanged when the transaction throws before commit', async () => {
    const paymentIntentId = await insertPaymentIntent(dataSource);
    const webhookEventId = await insertWebhookEvent(dataSource, {
      paymentIntentId,
      txHash: '0xcrash-before-commit',
    });

    const saveSpy = jest
      .spyOn(EntityManager.prototype, 'save')
      .mockImplementationOnce(() => {
        throw new Error('CRASH_BEFORE_COMMIT');
      });

    await expect(
      processor.processWebhookEvent({ webhookEventId, jobId: 'job-crash' }),
    ).rejects.toThrow('CRASH_BEFORE_COMMIT');

    saveSpy.mockRestore();

    await expectPaymentIntent(dataSource, paymentIntentId, {
      status: 'CREATED',
      confirmedTxHash: null,
    });
    await expectWebhookEvent(dataSource, webhookEventId, {
      status: 'RECEIVED',
      failureReason: null,
    });
    await expectAttemptRows(dataSource, webhookEventId, []);
  });

  it('rolls back the payment intent update when the crash happens after it but before commit', async () => {
    const paymentIntentId = await insertPaymentIntent(dataSource);
    const webhookEventId = await insertWebhookEvent(dataSource, {
      paymentIntentId,
      txHash: '0xcrash-after-intent-update',
    });

    // The processing attempt insert is the last write of the transaction: by
    // then the payment intent has been saved as CONFIRMED and the webhook as
    // PROCESSED. Failing here must roll all of that back.
    const saveSpy = jest.spyOn(EntityManager.prototype, 'save');
    const insertSpy = jest
      .spyOn(EntityManager.prototype, 'insert')
      .mockImplementationOnce(() => {
        throw new Error('CRASH_AFTER_INTENT_UPDATE');
      });

    try {
      await expect(
        processor.processWebhookEvent({
          webhookEventId,
          jobId: 'job-crash-late',
        }),
      ).rejects.toThrow('CRASH_AFTER_INTENT_UPDATE');

      // webhook -> PROCESSING, payment intent -> CONFIRMED, webhook -> PROCESSED
      expect(saveSpy).toHaveBeenCalledTimes(3);
    } finally {
      insertSpy.mockRestore();
      saveSpy.mockRestore();
    }

    await expectPaymentIntent(dataSource, paymentIntentId, {
      status: 'CREATED',
      confirmedTxHash: null,
    });
    await expectWebhookEvent(dataSource, webhookEventId, {
      status: 'RECEIVED',
      failureReason: null,
    });
    await expectAttemptRows(dataSource, webhookEventId, []);
  });
});

async function insertPaymentIntent(
  dataSource: DataSource,
  overrides: Partial<{
    id: string;
    status: PaymentIntentStatus;
    amount: string;
    asset: string;
    reference: string | null;
    confirmedTxHash: string | null;
  }> = {},
): Promise<string> {
  const paymentIntentId = overrides.id ?? randomUUID();

  await dataSource.query(
    `
      INSERT INTO payment_intents (
        id,
        status,
        amount,
        asset,
        destination,
        reference,
        client_request_id,
        metadata,
        confirmed_tx_hash,
        failure_reason
      )
      VALUES (
        $1,
        $2,
        $3,
        $4,
        'wallet_test_123',
        $5,
        NULL,
        '{}'::jsonb,
        $6,
        NULL
      )
    `,
    [
      paymentIntentId,
      overrides.status ?? PaymentIntentStatus.Created,
      overrides.amount ?? '125.50',
      overrides.asset ?? 'USDC',
      overrides.reference ?? 'order-1001',
      overrides.confirmedTxHash ?? null,
    ],
  );

  return paymentIntentId;
}

async function insertWebhookEvent(
  dataSource: DataSource,
  overrides: Partial<{
    status: 'RECEIVED' | 'PROCESSED';
    paymentIntentId: string;
    txHash: string | null;
    amount: string;
    asset: string;
    reference: string;
    type: string;
  }> = {},
): Promise<string> {
  const webhookEventId = randomUUID();
  const paymentIntentId = overrides.paymentIntentId ?? randomUUID();
  const type = overrides.type ?? 'transaction.confirmed';
  // txHash: null simulates a provider payload that omits the hash entirely.
  const txHash =
    overrides.txHash === undefined
      ? `0x${webhookEventId.replace(/-/g, '')}`
      : overrides.txHash;
  const payload = {
    eventId: `evt_${webhookEventId}`,
    type,
    paymentIntentId,
    ...(txHash === null ? {} : { txHash }),
    amount: overrides.amount ?? '125.50',
    asset: overrides.asset ?? 'USDC',
    ...(overrides.reference !== undefined
      ? { reference: overrides.reference }
      : {}),
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
        received_at,
        processed_at
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
        $8::webhook_event_status,
        now(),
        CASE WHEN $8::text = 'PROCESSED' THEN now() ELSE NULL END
      )
    `,
    [
      webhookEventId,
      payload.eventId,
      `nonce_${webhookEventId}`,
      paymentIntentId,
      txHash,
      JSON.stringify(payload),
      `hash_${webhookEventId}`,
      overrides.status ?? 'RECEIVED',
    ],
  );

  return webhookEventId;
}

async function expectPaymentIntent(
  dataSource: DataSource,
  paymentIntentId: string,
  expected: {
    status: string;
    confirmedTxHash: string | null;
  },
): Promise<void> {
  const rows = (await dataSource.query(
    `
      SELECT
        status,
        confirmed_tx_hash AS "confirmedTxHash"
      FROM payment_intents
      WHERE id = $1
    `,
    [paymentIntentId],
  )) as Array<{
    status: string;
    confirmedTxHash: string | null;
  }>;

  expect(rows).toEqual([expected]);
}

async function expectWebhookEvent(
  dataSource: DataSource,
  webhookEventId: string,
  expected: {
    status: string;
    failureReason: string | null;
  },
): Promise<void> {
  const rows = (await dataSource.query(
    `
      SELECT
        status,
        failure_reason AS "failureReason"
      FROM webhook_events
      WHERE id = $1
    `,
    [webhookEventId],
  )) as Array<{
    status: string;
    failureReason: string | null;
  }>;

  expect(rows).toEqual([expected]);
}

async function expectAttemptRows(
  dataSource: DataSource,
  webhookEventId: string,
  expected: Array<{
    jobId: string;
    status: string;
    errorMessage: string | null;
  }>,
): Promise<void> {
  const rows = (await dataSource.query(
    `
      SELECT
        job_id AS "jobId",
        status,
        error_message AS "errorMessage"
      FROM webhook_processing_attempts
      WHERE webhook_event_id = $1
      ORDER BY created_at ASC
    `,
    [webhookEventId],
  )) as Array<{
    jobId: string;
    status: string;
    errorMessage: string | null;
  }>;

  expect(rows).toEqual(expected);
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
