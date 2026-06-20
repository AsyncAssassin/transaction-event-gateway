import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';

import { WEBHOOK_EVENTS_QUEUE } from '../processing/queue.constants';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';

describe('HealthController', () => {
  let controller: HealthController;
  let dataSource: Pick<DataSource, 'isInitialized' | 'query'>;
  let redisClient: { ping: jest.Mock<Promise<string>, []> };

  beforeEach(async () => {
    dataSource = {
      isInitialized: true,
      query: jest.fn().mockResolvedValue([{ '?column?': 1 }]),
    };
    redisClient = {
      ping: jest.fn().mockResolvedValue('PONG'),
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
          provide: DataSource,
          useValue: dataSource,
        },
        {
          provide: WEBHOOK_EVENTS_QUEUE,
          useValue: {
            client: Promise.resolve(redisClient),
          },
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
    expect(dataSource.query).toHaveBeenCalledWith('SELECT 1');
    expect(redisClient.ping).toHaveBeenCalledTimes(1);
  });

  it('reports readiness failure when PostgreSQL is unavailable', async () => {
    dataSource.query = jest.fn().mockRejectedValue(new Error('db down'));

    await expect(controller.getReadiness()).rejects.toMatchObject({
      response: {
        error: 'SERVICE_UNAVAILABLE',
        details: [{ dependency: 'postgres' }],
      },
    });
  });

  it('reports readiness failure when Redis is unavailable', async () => {
    redisClient.ping.mockRejectedValue(new Error('redis down'));

    await expect(controller.getReadiness()).rejects.toMatchObject({
      response: {
        error: 'SERVICE_UNAVAILABLE',
        details: [{ dependency: 'redis' }],
      },
    });
  });

  it('reports readiness failure when Redis ping does not settle', async () => {
    jest.useFakeTimers();
    redisClient.ping.mockReturnValue(new Promise(() => undefined));

    try {
      const readiness = expect(controller.getReadiness()).rejects.toMatchObject({
        response: {
          error: 'SERVICE_UNAVAILABLE',
          details: [{ dependency: 'redis' }],
        },
      });

      await jest.advanceTimersByTimeAsync(1_000);
      await readiness;
    } finally {
      jest.useRealTimers();
    }
  });
});
