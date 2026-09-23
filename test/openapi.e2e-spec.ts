import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DataSource } from 'typeorm';

import { AppModule } from '../src/app.module';
import { configureHttpApp } from '../src/common/bootstrap';
import {
  OPENAPI_DOCUMENT_PATH,
  setupOpenApi,
} from '../src/common/openapi/openapi';

type SchemaObject = {
  $ref?: string;
  type?: string;
  format?: string;
  nullable?: boolean;
  required?: string[];
  properties?: Record<string, SchemaObject>;
};

type ResponseObject = {
  content?: Record<string, { schema?: SchemaObject }>;
  headers?: Record<string, unknown>;
};

type OperationObject = {
  operationId?: string;
  parameters?: Array<{ name: string; in: string; schema?: SchemaObject }>;
  requestBody?: { content: Record<string, { schema?: SchemaObject }> };
  responses: Record<string, ResponseObject>;
};

type OpenApiDocument = {
  paths: Record<string, Record<string, OperationObject>>;
  components: { schemas: Record<string, SchemaObject> };
};

const ERROR_SCHEMA = '#/components/schemas/ErrorResponseDto';

function responseSchema(
  operation: OperationObject,
  status: number,
): SchemaObject | undefined {
  return operation.responses[String(status)]?.content?.['application/json']
    ?.schema;
}

describe('OpenAPI document (e2e)', () => {
  let app: INestApplication;
  let document: OpenApiDocument;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication({ rawBody: true });
    configureHttpApp(app);
    setupOpenApi(app);
    await app.init();

    await truncatePaymentIntentTables(app.get(DataSource));

    const response = await request(app.getHttpServer())
      .get(`/${OPENAPI_DOCUMENT_PATH}`)
      .expect(200);
    document = response.body as OpenApiDocument;
  });

  afterAll(async () => {
    await truncatePaymentIntentTables(app.get(DataSource));
    await app.close();
  });

  it('describes the webhook request body although the handler reads the raw body', () => {
    const operation = document.paths['/webhooks/blockchain']!.post!;

    expect(
      operation.requestBody?.content['application/json']?.schema?.$ref,
    ).toBe('#/components/schemas/BlockchainWebhookDto');
    expect(document.components.schemas.BlockchainWebhookDto?.required).toEqual(
      expect.arrayContaining([
        'eventId',
        'type',
        'paymentIntentId',
        'amount',
        'asset',
      ]),
    );
  });

  it('gives every success response a schema', () => {
    const successResponses = [
      ['/payment-intents', 'post', 201, 'PaymentIntentResponseDto'],
      ['/payment-intents', 'post', 200, 'PaymentIntentResponseDto'],
      ['/payment-intents/{id}', 'get', 200, 'PaymentIntentResponseDto'],
      ['/webhooks/blockchain', 'post', 202, 'WebhookAcceptanceResponseDto'],
      ['/health/live', 'get', 200, 'LivenessResponseDto'],
      ['/health/ready', 'get', 200, 'ReadinessResponseDto'],
      ['/health/serving', 'get', 200, 'ServingReadinessResponseDto'],
    ] as const;

    for (const [path, method, status, schema] of successResponses) {
      expect(responseSchema(document.paths[path]![method]!, status)?.$ref).toBe(
        `#/components/schemas/${schema}`,
      );
    }
  });

  it('documents error statuses with the error envelope', () => {
    const errorResponses = [
      ['/payment-intents', 'post', [400, 409, 413, 415, 429, 503]],
      ['/payment-intents/{id}', 'get', [400, 404, 429, 503]],
      ['/webhooks/blockchain', 'post', [400, 401, 409, 413, 415, 429, 503]],
      ['/health/ready', 'get', [503]],
      ['/health/serving', 'get', [503]],
    ] as const;

    for (const [path, method, statuses] of errorResponses) {
      const operation = document.paths[path]![method]!;

      for (const status of statuses) {
        expect(responseSchema(operation, status)?.$ref).toBe(ERROR_SCHEMA);
      }
      if (statuses.includes(429 as never)) {
        expect(operation.responses['429']?.headers).toHaveProperty(
          'Retry-After',
        );
      }
    }

    expect(document.components.schemas.ErrorResponseDto?.required).toEqual([
      'error',
      'message',
      'correlationId',
    ]);
  });

  it('declares the payment intent ID parameter as a UUID', () => {
    const operation = document.paths['/payment-intents/{id}']!.get!;

    expect(operation.operationId).toBe('getPaymentIntent');
    expect(operation.parameters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'id',
          in: 'path',
          schema: expect.objectContaining({ format: 'uuid' }),
        }),
      ]),
    );
  });

  it('matches the payment intent schema to a real response', async () => {
    const created = await request(app.getHttpServer())
      .post('/payment-intents')
      .set('Idempotency-Key', 'openapi-schema-check')
      .send({ amount: '125.50', asset: 'USDC', destination: 'wallet_1' })
      .expect(201);
    const schema = document.components.schemas.PaymentIntentResponseDto!;

    expect(Object.keys(schema.properties ?? {}).sort()).toEqual(
      Object.keys(created.body as object).sort(),
    );
    expect(schema.required?.slice().sort()).toEqual(
      Object.keys(created.body as object).sort(),
    );
    for (const nullableField of [
      'reference',
      'clientRequestId',
      'confirmedTxHash',
    ]) {
      expect(schema.properties?.[nullableField]?.nullable).toBe(true);
    }
  });
});

async function truncatePaymentIntentTables(
  dataSource: DataSource,
): Promise<void> {
  await dataSource.query(
    'TRUNCATE TABLE idempotency_records, payment_intents RESTART IDENTITY CASCADE',
  );
}
