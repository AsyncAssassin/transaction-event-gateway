import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DataSource } from 'typeorm';

import { AppModule } from '../src/app.module';
import { configureHttpApp } from '../src/common/bootstrap';

type CountRow = {
  count: string;
};

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

    expect(response.body).toMatchObject({
      status: 'CREATED',
      amount: '125.50',
      asset: 'USDC',
      destination: 'wallet_test_123',
      reference: 'order-1001',
      clientRequestId: 'checkout-1001',
    });
    expect(response.body.id).toEqual(expect.any(String));
    expect(response.body.createdAt).toEqual(expect.any(String));
    expect(response.body.metadata).toBeUndefined();
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

async function truncatePaymentIntentTables(dataSource: DataSource): Promise<void> {
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
