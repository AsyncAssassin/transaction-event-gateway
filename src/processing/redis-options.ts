import { ConnectionOptions } from 'bullmq';
import { RedisOptions } from 'ioredis';

export type HealthRedisConnectionOptions = RedisOptions & {
  url: string;
};

export function createQueueRedisConnectionOptions(
  redisUrl: string,
): ConnectionOptions {
  return {
    url: redisUrl,
    connectTimeout: 2_000,
    maxRetriesPerRequest: 1,
  };
}

export function createWorkerRedisConnectionOptions(
  redisUrl: string,
): ConnectionOptions {
  return {
    url: redisUrl,
    connectTimeout: 2_000,
    maxRetriesPerRequest: null,
  };
}

export function createHealthRedisConnectionOptions(
  redisUrl: string,
): HealthRedisConnectionOptions {
  return {
    url: redisUrl,
    connectTimeout: 1_000,
    commandTimeout: 1_000,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    lazyConnect: true,
    retryStrategy: () => null,
  };
}
