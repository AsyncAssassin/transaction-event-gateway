import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

import { createHealthRedisConnectionOptions } from '../processing/redis-options';
import { RedisHealthCheckService } from './redis-health-check.service';

jest.mock('ioredis', () => jest.fn());

type RedisMock = {
  status: string;
  connect: jest.Mock<Promise<void>, []>;
  ping: jest.Mock<Promise<string>, []>;
  disconnect: jest.Mock<void, [boolean?]>;
  on: jest.Mock<RedisMock, [string, (error: Error) => void]>;
};

describe('RedisHealthCheckService', () => {
  const redisUrl = 'redis://localhost:6379';
  const redisConstructor = Redis as unknown as jest.Mock<
    RedisMock,
    [string, Record<string, unknown>]
  >;

  let service: RedisHealthCheckService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new RedisHealthCheckService({
      getOrThrow: jest.fn((key: string) =>
        key === 'REDIS_URL' ? redisUrl : undefined,
      ),
    } as unknown as ConfigService);
  });

  it('uses bounded fail-fast Redis health options', () => {
    expect(createHealthRedisConnectionOptions(redisUrl)).toMatchObject({
      url: redisUrl,
      connectTimeout: 1_000,
      commandTimeout: 1_000,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      lazyConnect: true,
    });
  });

  it('connects, pings, and keeps the health client for reuse', async () => {
    const redis = createRedisMock();
    redisConstructor.mockImplementationOnce(() => redis);

    await service.check();

    expect(redisConstructor).toHaveBeenCalledWith(redisUrl, {
      connectTimeout: 1_000,
      commandTimeout: 1_000,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      lazyConnect: true,
      retryStrategy: expect.any(Function),
    });
    expect(redis.on).toHaveBeenCalledWith('error', expect.any(Function));
    expect(redis.connect).toHaveBeenCalledTimes(1);
    expect(redis.ping).toHaveBeenCalledTimes(1);
    expect(redis.disconnect).not.toHaveBeenCalled();
  });

  it('pings an already ready health client without reconnecting', async () => {
    const redis = createRedisMock();
    redisConstructor.mockImplementationOnce(() => redis);

    await service.check();
    await service.check();

    expect(redisConstructor).toHaveBeenCalledTimes(1);
    expect(redis.connect).toHaveBeenCalledTimes(1);
    expect(redis.ping).toHaveBeenCalledTimes(2);
  });

  it('disconnects the active client on module destroy', async () => {
    const redis = createRedisMock();
    redisConstructor.mockImplementationOnce(() => redis);

    await service.check();
    service.onModuleDestroy();

    expect(redis.disconnect).toHaveBeenCalledWith(false);
  });

  it('replaces a client whose connection ended so the first check after recovery succeeds', async () => {
    const endedRedis = createRedisMock();
    const freshRedis = createRedisMock();
    redisConstructor
      .mockImplementationOnce(() => endedRedis)
      .mockImplementationOnce(() => freshRedis);

    await service.check();
    // Redis dropped the connection during an outage; with reconnects disabled
    // ioredis parks the client in 'end' and no readiness call observed it.
    endedRedis.status = 'end';

    await expect(service.check()).resolves.toBeUndefined();

    expect(endedRedis.disconnect).toHaveBeenCalledWith(false);
    expect(endedRedis.ping).toHaveBeenCalledTimes(1);
    expect(freshRedis.connect).toHaveBeenCalledTimes(1);
    expect(freshRedis.ping).toHaveBeenCalledTimes(1);
  });

  it('resets a failed client so a later check creates a fresh Redis client', async () => {
    const failedRedis = createRedisMock({
      connect: jest.fn().mockRejectedValue(new Error('redis down')),
    });
    const recoveredRedis = createRedisMock();
    redisConstructor
      .mockImplementationOnce(() => failedRedis)
      .mockImplementationOnce(() => recoveredRedis);

    await expect(service.check()).rejects.toThrow('redis down');
    await service.check();

    expect(failedRedis.disconnect).toHaveBeenCalledWith(false);
    expect(recoveredRedis.connect).toHaveBeenCalledTimes(1);
    expect(recoveredRedis.ping).toHaveBeenCalledTimes(1);
  });
});

function createRedisMock(overrides: Partial<RedisMock> = {}): RedisMock {
  const redis: RedisMock = {
    status: 'wait',
    connect: jest.fn(async () => {
      redis.status = 'ready';
    }),
    ping: jest.fn().mockResolvedValue('PONG'),
    disconnect: jest.fn(),
    on: jest.fn().mockImplementation(() => redis),
    ...overrides,
  };

  return redis;
}
