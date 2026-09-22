import type { INestApplication } from '@nestjs/common';
import request from 'supertest';

// ConfigModule.forRoot() validates process.env at import time, so the throttler
// limit must be set before AppModule is (re-)imported. This file resets the
// module registry, sets a low limit, dynamically imports the app, and restores
// the previous environment afterwards. The rest of the suite keeps
// RATE_LIMIT_ENABLED=false via test-env defaults.
describe('Rate limiting (e2e)', () => {
  let app: INestApplication;
  const previous: Record<string, string | undefined> = {};

  beforeAll(async () => {
    for (const key of [
      'RATE_LIMIT_ENABLED',
      'RATE_LIMIT_LIMIT',
      'RATE_LIMIT_TTL_SECONDS',
    ]) {
      previous[key] = process.env[key];
    }
    process.env.RATE_LIMIT_ENABLED = 'true';
    process.env.RATE_LIMIT_LIMIT = '3';
    process.env.RATE_LIMIT_TTL_SECONDS = '60';

    jest.resetModules();
    const { Test } = await import('@nestjs/testing');
    const { AppModule } = await import('../src/app.module');
    const { configureHttpApp } = await import('../src/common/bootstrap');

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication({ rawBody: true });
    configureHttpApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  it('returns 429 once the per-window request limit is exceeded', async () => {
    const statuses: number[] = [];

    // The throttler guard runs before the handler, so requests that would
    // otherwise fail validation still count toward the limit.
    for (let i = 0; i < 5; i += 1) {
      const response = await request(app.getHttpServer())
        .post('/payment-intents')
        .send({});
      statuses.push(response.status);
    }

    expect(statuses.slice(0, 3).every((status) => status !== 429)).toBe(true);
    expect(statuses.slice(3)).toEqual([429, 429]);
  });

  it('does not rate limit health endpoints', async () => {
    for (let i = 0; i < 5; i += 1) {
      await request(app.getHttpServer()).get('/health/live').expect(200);
    }
  });
});
