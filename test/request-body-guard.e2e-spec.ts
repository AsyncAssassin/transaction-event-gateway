import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DataSource } from 'typeorm';

import { AppModule } from '../src/app.module';
import { configureHttpApp } from '../src/common/bootstrap';

// Raw JSON strings keep the escapes intact: JSON.parse turns \u0000 and \ud800
// into the characters the guard must reject.
const validFields = '"amount":"125.50","asset":"USDC","destination":"wallet_1"';

describe('Request body guard (e2e)', () => {
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
    await truncateTables(dataSource);
  });

  afterAll(async () => {
    await truncateTables(dataSource);
    await app.close();
  });

  it.each([
    [
      'a NUL character in a column value',
      '{"amount":"125.50","asset":"USDC","destination":"wallet\\u0000x"}',
    ],
    [
      'a NUL character in a metadata key',
      `{${validFields},"metadata":{"a\\u0000b":"x"}}`,
    ],
    [
      'an escape character in metadata',
      `{${validFields},"metadata":{"a":"\\u001b[31m"}}`,
    ],
    [
      'a lone surrogate in metadata',
      `{${validFields},"metadata":{"a":"\\ud800"}}`,
    ],
    [
      'a lone surrogate in a column value',
      '{"amount":"125.50","asset":"USDC","destination":"w\\ud800"}',
    ],
    [
      'metadata nested 5000 levels deep',
      `{${validFields},"metadata":${'{"a":'.repeat(5_000)}1${'}'.repeat(5_000)}}`,
    ],
    [
      'metadata nested one level deeper than allowed',
      `{${validFields},"metadata":${'{"a":'.repeat(32)}1${'}'.repeat(32)}}`,
    ],
    ['a top-level constructor key', `{${validFields},"constructor":{"x":1}}`],
    ['a top-level __proto__ key', `{${validFields},"__proto__":{"x":1}}`],
    [
      'an Object.prototype method name in metadata',
      `{${validFields},"metadata":{"toString":"x"}}`,
    ],
  ])('rejects %s with 400 before it reaches the database', async (_, body) => {
    const response = await request(app.getHttpServer())
      .post('/payment-intents')
      .set('Content-Type', 'application/json')
      .set('Idempotency-Key', 'guard-rejected')
      .send(body)
      .expect(400);

    expect(response.body).toMatchObject({
      error: 'VALIDATION_ERROR',
      correlationId: response.headers['x-correlation-id'],
    });
    await expectPaymentIntentCount(dataSource, 0);
  });

  it('applies to urlencoded bodies as well', async () => {
    const response = await request(app.getHttpServer())
      .post('/payment-intents')
      .set('Content-Type', 'application/x-www-form-urlencoded')
      .set('Idempotency-Key', 'guard-urlencoded')
      .send('amount=125.50&asset=USDC&destination=wallet%00x')
      .expect(400);

    expect(response.body).toMatchObject({ error: 'VALIDATION_ERROR' });
    await expectPaymentIntentCount(dataSource, 0);
  });

  it('rejects a malformed webhook body before signature verification', async () => {
    const response = await request(app.getHttpServer())
      .post('/webhooks/blockchain')
      .set('Content-Type', 'application/json')
      .set('X-Webhook-Timestamp', String(Math.floor(Date.now() / 1000)))
      .set('X-Webhook-Nonce', 'nonce_guard')
      .set('X-Webhook-Signature', `v1=${'0'.repeat(64)}`)
      .send('{"eventId":"evt_\\u0000","type":"transaction.confirmed"}')
      .expect(400);

    expect(response.body).toMatchObject({ error: 'VALIDATION_ERROR' });
    const rows = (await dataSource.query(
      'SELECT count(*)::int AS "count" FROM webhook_events',
    )) as Array<{ count: number }>;
    expect(rows[0]?.count).toBe(0);
  });

  it('still accepts tabs, line breaks, surrogate pairs, and the maximum nesting depth', async () => {
    // The body is level 1 and metadata level 2, so the 30 objects nested in
    // metadata.deep occupy levels 3 to 32, the maximum.
    const deepestAllowed = `${'{"a":'.repeat(30)}1${'}'.repeat(30)}`;

    await request(app.getHttpServer())
      .post('/payment-intents')
      .set('Content-Type', 'application/json')
      .set('Idempotency-Key', 'guard-accepted')
      .send(
        `{${validFields},"metadata":{"note":"line one\\n\\tline two \\ud83d\\udcb8","deep":${deepestAllowed}}}`,
      )
      .expect(201);

    await expectPaymentIntentCount(dataSource, 1);
  });
});

async function expectPaymentIntentCount(
  dataSource: DataSource,
  expectedCount: number,
): Promise<void> {
  const rows = (await dataSource.query(
    'SELECT count(*)::int AS "count" FROM payment_intents',
  )) as Array<{ count: number }>;

  expect(rows[0]?.count).toBe(expectedCount);
}

async function truncateTables(dataSource: DataSource): Promise<void> {
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
