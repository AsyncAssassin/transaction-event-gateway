import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DataSource } from 'typeorm';

import { AppModule } from '../src/app.module';
import { configureHttpApp } from '../src/common/bootstrap';

type CountRow = {
  count: string;
};

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const validPayload = {
  amount: '125.50',
  asset: 'USDC',
  destination: 'wallet_test_123',
  reference: 'order-1001',
  clientRequestId: 'checkout-1001',
  metadata: {
    customerId: 'cust_123',
  },
};

describe('Payment intents (e2e)', () => {
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
    await truncatePaymentIntentTables(dataSource);
  });

  afterAll(async () => {
    await truncatePaymentIntentTables(dataSource);
    await app.close();
  });

  it('creates a payment intent', async () => {
    const response = await request(app.getHttpServer())
      .post('/payment-intents')
      .set('Idempotency-Key', 'pi-create-happy-path')
      .send(validPayload)
      .expect(201);

    expect(response.body).toEqual({
      id: expect.stringMatching(uuidPattern),
      status: 'CREATED',
      amount: '125.5',
      asset: 'USDC',
      destination: 'wallet_test_123',
      reference: 'order-1001',
      clientRequestId: 'checkout-1001',
      confirmedTxHash: null,
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
    });
    expect(response.body.updatedAt).toBe(response.body.createdAt);
  });

  it.each([
    ['100.00', '100'],
    ['0.000000000000000001', '0.000000000000000001'],
    [
      '999999999999999999.999999999999999999',
      '999999999999999999.999999999999999999',
    ],
  ])(
    'returns the amount %s in canonical form %s when creating and reading',
    async (amount, canonicalAmount) => {
      const created = await request(app.getHttpServer())
        .post('/payment-intents')
        .set('Idempotency-Key', `pi-canonical-${amount}`)
        .send({ ...validPayload, amount })
        .expect(201);

      const read = await request(app.getHttpServer())
        .get(`/payment-intents/${created.body.id}`)
        .expect(200);

      expect(created.body.amount).toBe(canonicalAmount);
      expect(read.body.amount).toBe(canonicalAmount);
    },
  );

  it('reads a payment intent in the same form as its creation response', async () => {
    const created = await request(app.getHttpServer())
      .post('/payment-intents')
      .set('Idempotency-Key', 'pi-read-after-create')
      .send(validPayload)
      .expect(201);

    const read = await request(app.getHttpServer())
      .get(`/payment-intents/${created.body.id}`)
      .expect(200);

    expect(read.body).toEqual(created.body);
    expect(read.body.metadata).toBeUndefined();
  });

  it('reads the confirmation the worker applied', async () => {
    const created = await request(app.getHttpServer())
      .post('/payment-intents')
      .set('Idempotency-Key', 'pi-read-confirmed')
      .send(validPayload)
      .expect(201);

    // The worker writes these columns when it applies a matching
    // transaction.confirmed webhook.
    await dataSource.query(
      `
        UPDATE payment_intents
        SET status = 'CONFIRMED',
            confirmed_tx_hash = '0xconfirmed',
            updated_at = created_at + interval '2 seconds'
        WHERE id = $1
      `,
      [created.body.id],
    );

    const read = await request(app.getHttpServer())
      .get(`/payment-intents/${created.body.id}`)
      .expect(200);

    expect(read.body).toEqual({
      ...created.body,
      status: 'CONFIRMED',
      confirmedTxHash: '0xconfirmed',
      updatedAt: new Date(
        Date.parse(created.body.createdAt) + 2_000,
      ).toISOString(),
    });
  });

  it('answers an unknown payment intent ID with 404 NOT_FOUND', async () => {
    const response = await request(app.getHttpServer())
      .get('/payment-intents/5f70a0c2-7bb5-4545-b181-3fcff9b56b86')
      .expect(404);

    expect(response.body).toEqual({
      error: 'NOT_FOUND',
      message: 'Payment intent not found.',
      correlationId: response.headers['x-correlation-id'],
    });
  });

  it('rejects an ID that is not a UUID with 400 VALIDATION_ERROR', async () => {
    const response = await request(app.getHttpServer())
      .get('/payment-intents/not-a-uuid')
      .expect(400);

    expect(response.body).toEqual({
      error: 'VALIDATION_ERROR',
      message: 'Request validation failed.',
      details: [{ field: 'id', message: 'id must be a UUID' }],
      correlationId: response.headers['x-correlation-id'],
    });
  });

  it('rejects a missing Idempotency-Key header', async () => {
    const response = await request(app.getHttpServer())
      .post('/payment-intents')
      .send(validPayload)
      .expect(400);

    expect(response.body).toMatchObject({
      error: 'VALIDATION_ERROR',
    });
  });

  it('rejects DTO validation failures', async () => {
    const response = await request(app.getHttpServer())
      .post('/payment-intents')
      .set('Idempotency-Key', 'pi-invalid-payload')
      .send({
        ...validPayload,
        amount: '0',
      })
      .expect(400);

    expect(response.body).toMatchObject({
      error: 'VALIDATION_ERROR',
    });
    expect(response.body.details).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: 'amount' })]),
    );
  });

  it('rejects an oversized request body with 413', async () => {
    const response = await request(app.getHttpServer())
      .post('/payment-intents')
      .set('Idempotency-Key', 'pi-oversized')
      .send({
        ...validPayload,
        metadata: { blob: 'A'.repeat(300_000) },
      })
      .expect(413);

    expect(response.body).toMatchObject({ error: 'PAYLOAD_TOO_LARGE' });
  });

  it('treats a different numeric string form as a conflict (the request hash is not normalized)', async () => {
    await request(app.getHttpServer())
      .post('/payment-intents')
      .set('Idempotency-Key', 'pi-numeric-form')
      .send({ ...validPayload, amount: '125.50' })
      .expect(201);

    const conflict = await request(app.getHttpServer())
      .post('/payment-intents')
      .set('Idempotency-Key', 'pi-numeric-form')
      .send({ ...validPayload, amount: '125.5' })
      .expect(409);

    expect(conflict.body).toMatchObject({ error: 'IDEMPOTENCY_CONFLICT' });
    await expectPaymentIntentCount(dataSource, 1);
  });

  it('creates exactly one intent for concurrent same key with different payloads', async () => {
    const [firstResponse, secondResponse] = await Promise.all([
      request(app.getHttpServer())
        .post('/payment-intents')
        .set('Idempotency-Key', 'pi-concurrent-conflict')
        .send(validPayload),
      request(app.getHttpServer())
        .post('/payment-intents')
        .set('Idempotency-Key', 'pi-concurrent-conflict')
        .send({ ...validPayload, amount: '999.99' }),
    ]);

    const statuses = [firstResponse.status, secondResponse.status].sort();
    expect(statuses).toEqual([201, 409]);
    await expectPaymentIntentCount(dataSource, 1);
  });

  it('replays the stored response for the same key and same payload', async () => {
    const firstResponse = await request(app.getHttpServer())
      .post('/payment-intents')
      .set('Idempotency-Key', 'pi-replay-same-payload')
      .send(validPayload)
      .expect(201);

    const replayResponse = await request(app.getHttpServer())
      .post('/payment-intents')
      .set('Idempotency-Key', 'pi-replay-same-payload')
      .send({
        ...validPayload,
        metadata: {
          customerId: 'cust_123',
        },
      })
      .expect(200);

    expect(replayResponse.headers['idempotent-replayed']).toBe('true');
    expect(replayResponse.body).toEqual(firstResponse.body);
    await expectPaymentIntentCount(dataSource, 1);
  });

  it('rejects the same key with a different payload without creating another payment intent', async () => {
    const firstResponse = await request(app.getHttpServer())
      .post('/payment-intents')
      .set('Idempotency-Key', 'pi-conflicting-payload')
      .send(validPayload)
      .expect(201);

    const conflictResponse = await request(app.getHttpServer())
      .post('/payment-intents')
      .set('Idempotency-Key', 'pi-conflicting-payload')
      .send({
        ...validPayload,
        amount: '126.50',
      })
      .expect(409);

    expect(conflictResponse.body).toMatchObject({
      error: 'IDEMPOTENCY_CONFLICT',
    });
    await expectPaymentIntentCount(dataSource, 1);

    const rows = (await dataSource.query(
      'SELECT id, amount FROM payment_intents',
    )) as Array<{ id: string; amount: string }>;
    expect(rows).toEqual([
      {
        id: firstResponse.body.id,
        amount: '125.500000000000000000',
      },
    ]);
  });

  it('creates only one payment intent for concurrent duplicate requests', async () => {
    const [firstResponse, secondResponse] = await Promise.all([
      request(app.getHttpServer())
        .post('/payment-intents')
        .set('Idempotency-Key', 'pi-concurrent-replay')
        .send(validPayload),
      request(app.getHttpServer())
        .post('/payment-intents')
        .set('Idempotency-Key', 'pi-concurrent-replay')
        .send(validPayload),
    ]);

    const statuses = [firstResponse.status, secondResponse.status].sort();
    expect(statuses).toEqual([200, 201]);
    expect(firstResponse.body).toEqual(secondResponse.body);
    await expectPaymentIntentCount(dataSource, 1);
  });
});

async function truncatePaymentIntentTables(
  dataSource: DataSource,
): Promise<void> {
  await dataSource.query(
    'TRUNCATE TABLE idempotency_records, payment_intents RESTART IDENTITY CASCADE',
  );
}

async function expectPaymentIntentCount(
  dataSource: DataSource,
  expectedCount: number,
): Promise<void> {
  const rows = (await dataSource.query(
    'SELECT COUNT(*)::text AS count FROM payment_intents',
  )) as CountRow[];

  expect(rows[0]?.count).toBe(String(expectedCount));
}
