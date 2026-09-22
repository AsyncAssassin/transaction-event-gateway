import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';

import { HealthController } from './health.controller';
import { HealthService } from './health.service';
import { PostgresHealthCheckService } from './postgres-health-check.service';
import { RedisHealthCheckService } from './redis-health-check.service';

describe('HealthController', () => {
  let controller: HealthController;
  let postgresHealthCheck: { check: jest.Mock<Promise<void>, []> };
  let redisHealthCheck: { check: jest.Mock<Promise<void>, []> };

  beforeEach(async () => {
    postgresHealthCheck = {
      check: jest.fn().mockResolvedValue(undefined),
    };
    redisHealthCheck = {
      check: jest.fn().mockResolvedValue(undefined),
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        HealthService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              const values: Record<string, string> = {
                NODE_ENV: 'test',
                PORT: '3000',
                DATABASE_URL:
                  'postgres://test:test@localhost:5432/transaction_event_gateway_test',
                REDIS_URL: 'redis://localhost:6379',
                WEBHOOK_SECRET: 'test-webhook-secret-value',
                WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS: '300',
              };

              return values[key];
            }),
          },
        },
        {
          provide: PostgresHealthCheckService,
          useValue: postgresHealthCheck,
        },
        {
          provide: RedisHealthCheckService,
          useValue: redisHealthCheck,
        },
      ],
    }).compile();

    controller = moduleRef.get(HealthController);
  });

  it('returns liveness status', () => {
    expect(controller.getLiveness()).toMatchObject({
      status: 'ok',
    });
  });

  it('returns readiness status for loaded configuration and database', async () => {
    await expect(controller.getReadiness()).resolves.toMatchObject({
      status: 'ready',
      checks: {
        config: 'ok',
        postgres: 'ok',
        redis: 'ok',
      },
    });
    expect(postgresHealthCheck.check).toHaveBeenCalledTimes(1);
    expect(redisHealthCheck.check).toHaveBeenCalledTimes(1);
  });

  it('reports readiness failure when PostgreSQL is unavailable', async () => {
    postgresHealthCheck.check.mockRejectedValue(new Error('db down'));

    await expect(controller.getReadiness()).rejects.toMatchObject({
      response: {
        error: 'SERVICE_UNAVAILABLE',
        details: [{ dependency: 'postgres' }],
      },
    });
  });

  it('reports readiness failure when Redis is unavailable', async () => {
    redisHealthCheck.check.mockRejectedValue(new Error('redis down'));

    await expect(controller.getReadiness()).rejects.toMatchObject({
      response: {
        error: 'SERVICE_UNAVAILABLE',
        details: [{ dependency: 'redis' }],
      },
    });
  });

  it('returns serving readiness for configuration and PostgreSQL without Redis', async () => {
    await expect(controller.getServingReadiness()).resolves.toMatchObject({
      status: 'ready',
      checks: {
        config: 'ok',
        postgres: 'ok',
      },
    });
    expect(postgresHealthCheck.check).toHaveBeenCalledTimes(1);
    expect(redisHealthCheck.check).not.toHaveBeenCalled();
  });

  it('reports serving readiness failure when PostgreSQL is unavailable', async () => {
    postgresHealthCheck.check.mockRejectedValue(new Error('db down'));

    await expect(controller.getServingReadiness()).rejects.toMatchObject({
      response: {
        error: 'SERVICE_UNAVAILABLE',
        message: 'PostgreSQL readiness check failed.',
        details: [{ dependency: 'postgres' }],
      },
    });
  });
});
