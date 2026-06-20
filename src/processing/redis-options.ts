import { ConnectionOptions } from 'bullmq';

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
