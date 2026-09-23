import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Server } from 'node:http';
import request from 'supertest';
import { DataSource } from 'typeorm';

import { AppModule } from '../src/app.module';
import {
  configureHttpApp,
  HEADERS_TIMEOUT_MS,
  KEEP_ALIVE_TIMEOUT_MS,
} from '../src/common/bootstrap';
import { POSTGRES_HEALTH_APPLICATION_NAME } from '../src/health/postgres-health-check.service';

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe('Health endpoints (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication({
      rawBody: true,
    });
    configureHttpApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /health/live', async () => {
    const response = await request(app.getHttpServer())
      .get('/health/live')
      .expect(200);

    expect(response.body).toMatchObject({
      status: 'ok',
    });
  });

  it('does not send an X-Powered-By header', async () => {
    const response = await request(app.getHttpServer())
      .get('/health/live')
      .expect(200);

    expect(response.headers['x-powered-by']).toBeUndefined();
  });

  it('keeps idle connections open longer than the load balancer idle timeout of 60 s', async () => {
    const server = app.getHttpServer() as Server;
    expect(KEEP_ALIVE_TIMEOUT_MS).toBeGreaterThan(60_000);
    expect(HEADERS_TIMEOUT_MS).toBeGreaterThan(KEEP_ALIVE_TIMEOUT_MS);
    expect(server.keepAliveTimeout).toBe(KEEP_ALIVE_TIMEOUT_MS);
    expect(server.headersTimeout).toBe(HEADERS_TIMEOUT_MS);

    const response = await request(server)
      .get('/health/live')
      .set('Connection', 'keep-alive')
      .expect(200);

    expect(response.headers['keep-alive']).toBe(
      `timeout=${KEEP_ALIVE_TIMEOUT_MS / 1_000}`,
    );
  });

  it('returns a provided correlation ID', async () => {
    const response = await request(app.getHttpServer())
      .get('/health/live')
      .set('X-Correlation-ID', 'request-123')
      .expect(200);

    expect(response.headers['x-correlation-id']).toBe('request-123');
  });

  it('generates a correlation ID when one is missing', async () => {
    const response = await request(app.getHttpServer())
      .get('/health/live')
      .expect(200);

    expect(response.headers['x-correlation-id']).toMatch(uuidPattern);
  });

  it('returns correlation ID on oversized JSON parser errors', async () => {
    const response = await request(app.getHttpServer())
      .post('/payment-intents')
      .set('X-Correlation-ID', 'request-oversized-123')
      .send({ payload: 'x'.repeat(300 * 1024) })
      .expect(413);

    expect(response.headers['x-correlation-id']).toBe('request-oversized-123');
    expect(response.body).toMatchObject({
      error: 'PAYLOAD_TOO_LARGE',
      correlationId: 'request-oversized-123',
    });
  });

  it('returns generated correlation ID on malformed JSON parser errors', async () => {
    const response = await request(app.getHttpServer())
      .post('/payment-intents')
      .set('Content-Type', 'application/json')
      .send('{"bad":')
      .expect(400);

    const correlationId = response.headers['x-correlation-id'];
    expect(correlationId).toMatch(uuidPattern);
    expect(response.body).toMatchObject({
      error: 'VALIDATION_ERROR',
      correlationId,
    });
    expect(response.body).not.toHaveProperty('stack');
    expect(JSON.stringify(response.body)).not.toMatch(/SyntaxError|stack/);
  });

  it('accepts JSON below the explicit parser limit', async () => {
    const response = await request(app.getHttpServer())
      .post('/payment-intents')
      .set('X-Correlation-ID', 'request-below-limit-123')
      .send({ payload: 'x'.repeat(200 * 1024) })
      .expect(400);

    expect(response.headers['x-correlation-id']).toBe(
      'request-below-limit-123',
    );
    expect(response.body).toMatchObject({
      error: 'VALIDATION_ERROR',
      correlationId: 'request-below-limit-123',
    });
  });

  it('GET /health/ready', async () => {
    const response = await request(app.getHttpServer())
      .get('/health/ready')
      .expect(200);

    expect(response.body).toMatchObject({
      status: 'ready',
      checks: {
        config: 'ok',
        postgres: 'ok',
        redis: 'ok',
      },
    });
  });

  it('GET /health/serving reports config and PostgreSQL without Redis', async () => {
    const response = await request(app.getHttpServer())
      .get('/health/serving')
      .expect(200);

    expect(response.body).toMatchObject({
      status: 'ready',
      checks: {
        config: 'ok',
        postgres: 'ok',
      },
    });
    expect(response.body.checks.redis).toBeUndefined();
  });

  it('survives PostgreSQL terminating the idle health-check connection', async () => {
    // Warm the isolated health pool so it holds an idle client.
    await request(app.getHttpServer()).get('/health/serving').expect(200);

    // Simulate a PostgreSQL restart/failover for that client only. pg-pool
    // re-emits the resulting client error on the pool; without a listener the
    // process would exit with an unhandled 'error' event.
    const dataSource = app.get(DataSource);
    const terminated = (await dataSource.query(
      `
        SELECT count(*)::int AS "count"
        FROM (
          SELECT pg_terminate_backend(pid)
          FROM pg_stat_activity
          WHERE application_name = $1
        ) AS killed
      `,
      [POSTGRES_HEALTH_APPLICATION_NAME],
    )) as Array<{ count: number }>;
    expect(terminated[0]?.count).toBeGreaterThanOrEqual(1);

    await waitForHealthSessionsToClose(dataSource);

    await request(app.getHttpServer()).get('/health/serving').expect(200);
  });
});

async function waitForHealthSessionsToClose(
  dataSource: DataSource,
): Promise<void> {
  const deadline = Date.now() + 5_000;

  while (Date.now() < deadline) {
    const rows = (await dataSource.query(
      `
        SELECT count(*)::int AS "count"
        FROM pg_stat_activity
        WHERE application_name = $1
      `,
      [POSTGRES_HEALTH_APPLICATION_NAME],
    )) as Array<{ count: number }>;

    if ((rows[0]?.count ?? 0) === 0) {
      // Let the terminated socket surface its error on the pool before reuse.
      await new Promise((resolve) => setTimeout(resolve, 100));
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  throw new Error(
    'Health-check PostgreSQL sessions were not terminated in time.',
  );
}
