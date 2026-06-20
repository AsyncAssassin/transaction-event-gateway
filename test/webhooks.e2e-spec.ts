import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DataSource } from 'typeorm';

import { AppModule } from '../src/app.module';
import { configureHttpApp } from '../src/common/bootstrap';
import { createWebhookSignature } from '../src/webhooks/security/webhook-signature';

type CountRow = {
  count: string;
};

type WebhookPayload = {
  eventId: string;
  type: string;
  paymentIntentId: string;
  txHash: string;
  amount: string;
  asset: string;
};

const webhookSecret = 'test-webhook-secret-value';

const basePayload: WebhookPayload = {
  eventId: 'evt_123',
  type: 'transaction.confirmed',
  paymentIntentId: '5f70a0c2-7bb5-4545-b181-3fcff9b56b86',
  txHash: '0xtest123',
  amount: '125.50',
  asset: 'USDC',
};

describe('Blockchain webhooks (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication({
      rawBody: true,
    });
    configureHttpApp(app);
    await app.init();

    dataSource = app.get(DataSource);
  });

  beforeEach(async () => {
    await truncateWebhookTables(dataSource);
  });

  afterAll(async () => {
    await truncateWebhookTables(dataSource);
    await app.close();
  });

  it('accepts a valid signed webhook and creates one inbox row and one outbox row', async () => {
    const response = await sendSignedWebhook({
      app,
      payload: basePayload,
      nonce: 'nonce_accepted',
    }).expect(202);

    expect(response.body).toEqual({
      eventId: 'evt_123',
      status: 'ACCEPTED',
    });

    await expectTableCount(dataSource, 'webhook_events', 1);
    await expectTableCount(dataSource, 'outbox_events', 1);

    const rows = (await dataSource.query(`
      SELECT
        we.provider,
        we.external_event_id AS "externalEventId",
        we.nonce,
        we.event_type AS "eventType",
        we.payload_hash AS "payloadHash",
        we.status AS "webhookStatus",
        oe.type AS "outboxType",
        oe.aggregate_type AS "aggregateType",
        oe.aggregate_id AS "aggregateId",
        oe.payload AS "outboxPayload",
        oe.status AS "outboxStatus"
      FROM webhook_events we
      JOIN outbox_events oe ON oe.aggregate_id = we.id
    `)) as Array<{
      provider: string;
      externalEventId: string;
      nonce: string;
      eventType: string;
      payloadHash: string;
      webhookStatus: string;
      outboxType: string;
      aggregateType: string;
      aggregateId: string;
      outboxPayload: { webhookEventId: string };
      outboxStatus: string;
    }>;

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      provider: 'blockchain',
      externalEventId: 'evt_123',
      nonce: 'nonce_accepted',
      eventType: 'transaction.confirmed',
      webhookStatus: 'RECEIVED',
      outboxType: 'process-webhook-event',
      aggregateType: 'webhook_event',
      outboxStatus: 'PENDING',
    });
    expect(rows[0]?.payloadHash).toMatch(/^[a-f0-9]{64}$/);
    expect(rows[0]?.outboxPayload).toEqual({
      webhookEventId: rows[0]?.aggregateId,
    });
  });

  it('rejects an invalid signature without persisting inbox or outbox rows', async () => {
    const body = JSON.stringify(basePayload);
    const timestamp = currentTimestamp();

    const response = await request(app.getHttpServer())
      .post('/webhooks/blockchain')
      .set('Content-Type', 'application/json')
      .set('X-Webhook-Timestamp', timestamp)
      .set('X-Webhook-Nonce', 'nonce_bad_signature')
      .set('X-Webhook-Signature', `v1=${'0'.repeat(64)}`)
      .send(body)
      .expect(401);

    expect(response.body).toMatchObject({
      error: 'INVALID_WEBHOOK_SIGNATURE',
    });
    await expectWebhookAndOutboxCounts(dataSource, 0, 0);
  });

  it('rejects a stale timestamp without persisting inbox or outbox rows', async () => {
    const response = await sendSignedWebhook({
      app,
      payload: basePayload,
      nonce: 'nonce_stale',
      timestamp: String(Math.floor(Date.now() / 1000) - 1_000),
    }).expect(408);

    expect(response.body).toMatchObject({
      error: 'STALE_WEBHOOK_TIMESTAMP',
    });
    await expectWebhookAndOutboxCounts(dataSource, 0, 0);
  });

  it('returns ALREADY_ACCEPTED for a duplicate identical webhook without new rows', async () => {
    await sendSignedWebhook({
      app,
      payload: basePayload,
      nonce: 'nonce_duplicate',
    }).expect(202);

    const replayResponse = await sendSignedWebhook({
      app,
      payload: basePayload,
      nonce: 'nonce_duplicate',
    }).expect(202);

    expect(replayResponse.body).toEqual({
      eventId: 'evt_123',
      status: 'ALREADY_ACCEPTED',
    });
    await expectWebhookAndOutboxCounts(dataSource, 1, 1);
  });

  it('rejects the same eventId with a different payload', async () => {
    await sendSignedWebhook({
      app,
      payload: basePayload,
      nonce: 'nonce_conflict_first',
    }).expect(202);

    const conflictResponse = await sendSignedWebhook({
      app,
      payload: {
        ...basePayload,
        amount: '126.50',
      },
      nonce: 'nonce_conflict_second',
    }).expect(409);

    expect(conflictResponse.body).toMatchObject({
      error: 'WEBHOOK_EVENT_CONFLICT',
    });
    await expectWebhookAndOutboxCounts(dataSource, 1, 1);
  });

  it('rejects nonce replay for a different event', async () => {
    await sendSignedWebhook({
      app,
      payload: basePayload,
      nonce: 'nonce_replay',
    }).expect(202);

    const replayResponse = await sendSignedWebhook({
      app,
      payload: {
        ...basePayload,
        eventId: 'evt_456',
        txHash: '0xtest456',
      },
      nonce: 'nonce_replay',
    }).expect(409);

    expect(replayResponse.body).toMatchObject({
      error: 'WEBHOOK_NONCE_REPLAY',
    });
    await expectWebhookAndOutboxCounts(dataSource, 1, 1);
  });

  it('rejects an invalid DTO after signature verification without persisting rows', async () => {
    const response = await sendSignedWebhook({
      app,
      payload: {
        ...basePayload,
        paymentIntentId: 'not-a-uuid',
      },
      nonce: 'nonce_invalid_dto',
    }).expect(400);

    expect(response.body).toMatchObject({
      error: 'VALIDATION_ERROR',
    });
    await expectWebhookAndOutboxCounts(dataSource, 0, 0);
  });

  it('creates one inbox and one outbox row for concurrent duplicate delivery', async () => {
    const firstRequest = sendSignedWebhook({
      app,
      payload: basePayload,
      nonce: 'nonce_concurrent',
    });
    const secondRequest = sendSignedWebhook({
      app,
      payload: basePayload,
      nonce: 'nonce_concurrent',
    });

    const [firstResponse, secondResponse] = await Promise.all([
      firstRequest,
      secondRequest,
    ]);

    const statuses = [firstResponse.body.status, secondResponse.body.status].sort();
    expect(firstResponse.status).toBe(202);
    expect(secondResponse.status).toBe(202);
    expect(statuses).toEqual(['ACCEPTED', 'ALREADY_ACCEPTED']);
    await expectWebhookAndOutboxCounts(dataSource, 1, 1);
  });
});

function sendSignedWebhook({
  app,
  payload,
  nonce,
  timestamp = currentTimestamp(),
}: {
  app: INestApplication;
  payload: Record<string, unknown>;
  nonce: string;
  timestamp?: string;
}): request.Test {
  const body = JSON.stringify(payload);
  const signature = createWebhookSignature({
    secret: webhookSecret,
    timestamp,
    nonce,
    rawBody: body,
  });

  return request(app.getHttpServer())
    .post('/webhooks/blockchain')
    .set('Content-Type', 'application/json')
    .set('X-Webhook-Timestamp', timestamp)
    .set('X-Webhook-Nonce', nonce)
    .set('X-Webhook-Signature', signature)
    .send(body);
}

function currentTimestamp(): string {
  return String(Math.floor(Date.now() / 1000));
}

async function truncateWebhookTables(dataSource: DataSource): Promise<void> {
  await dataSource.query(
    'TRUNCATE TABLE outbox_events, webhook_events RESTART IDENTITY CASCADE',
  );
}

async function expectWebhookAndOutboxCounts(
  dataSource: DataSource,
  expectedWebhookCount: number,
  expectedOutboxCount: number,
): Promise<void> {
  await expectTableCount(dataSource, 'webhook_events', expectedWebhookCount);
  await expectTableCount(dataSource, 'outbox_events', expectedOutboxCount);
}

async function expectTableCount(
  dataSource: DataSource,
  tableName: 'webhook_events' | 'outbox_events',
  expectedCount: number,
): Promise<void> {
  const rows = (await dataSource.query(
    `SELECT COUNT(*)::text AS count FROM ${tableName}`,
  )) as CountRow[];

  expect(rows[0]?.count).toBe(String(expectedCount));
}
