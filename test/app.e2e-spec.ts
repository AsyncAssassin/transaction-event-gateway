import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../src/app.module';
import { configureHttpApp } from '../src/common/bootstrap';

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

    expect(response.headers['x-correlation-id']).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
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
});
