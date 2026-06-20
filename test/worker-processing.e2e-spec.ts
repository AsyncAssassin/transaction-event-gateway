import { Test, TestingModule } from '@nestjs/testing';
import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';

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
});

async function insertPaymentIntent(
  dataSource: DataSource,
  overrides: Partial<{
    status: PaymentIntentStatus;
    amount: string;
    asset: string;
    reference: string | null;
  }> = {},
): Promise<string> {
  const paymentIntentId = randomUUID();

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
        NULL,
        NULL
      )
    `,
    [
      paymentIntentId,
      overrides.status ?? PaymentIntentStatus.Created,
      overrides.amount ?? '125.50',
      overrides.asset ?? 'USDC',
      overrides.reference ?? 'order-1001',
    ],
  );

  return paymentIntentId;
}

async function insertWebhookEvent(
  dataSource: DataSource,
  overrides: Partial<{
    status: 'RECEIVED' | 'PROCESSED';
    paymentIntentId: string;
    txHash: string;
    amount: string;
    asset: string;
    reference: string;
  }> = {},
): Promise<string> {
  const webhookEventId = randomUUID();
  const paymentIntentId = overrides.paymentIntentId ?? randomUUID();
  const payload = {
    eventId: `evt_${webhookEventId}`,
    type: 'transaction.confirmed',
    paymentIntentId,
    txHash: overrides.txHash ?? `0x${webhookEventId.replace(/-/g, '')}`,
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
      payload.txHash,
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
