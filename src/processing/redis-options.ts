import { ConnectionOptions } from 'bullmq';
import { RedisOptions } from 'ioredis';

export type HealthRedisConnectionOptions = RedisOptions & {
  url: string;
};

// The outbox dispatcher publishes while holding row locks in a PostgreSQL
// transaction, so a Redis that accepts the connection but never answers must
// fail the publish instead of holding those locks indefinitely.
export const QUEUE_REDIS_COMMAND_TIMEOUT_MS = 5_000;

export function createQueueRedisConnectionOptions(
  redisUrl: string,
): ConnectionOptions {
  return {
    url: redisUrl,
    connectTimeout: 2_000,
    commandTimeout: QUEUE_REDIS_COMMAND_TIMEOUT_MS,
    maxRetriesPerRequest: 1,
  };
}

// No commandTimeout here: BullMQ blocks in BZPOPMIN on this connection for up
// to 10 seconds per call and requires maxRetriesPerRequest: null for it.
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
