import {
  createQueueRedisConnectionOptions,
  createWorkerRedisConnectionOptions,
  QUEUE_REDIS_COMMAND_TIMEOUT_MS,
} from './redis-options';

describe('Redis connection options', () => {
  it('bounds every publisher command so a hung Redis fails the publish', () => {
    expect(
      createQueueRedisConnectionOptions('redis://localhost:6379'),
    ).toMatchObject({
      url: 'redis://localhost:6379',
      commandTimeout: QUEUE_REDIS_COMMAND_TIMEOUT_MS,
      maxRetriesPerRequest: 1,
    });
    expect(QUEUE_REDIS_COMMAND_TIMEOUT_MS).toBe(5_000);
  });

  it('keeps the worker connection free of a command timeout for blocking commands', () => {
    const options = createWorkerRedisConnectionOptions(
      'redis://localhost:6379',
    );

    expect(options).toMatchObject({ maxRetriesPerRequest: null });
    expect(options).not.toHaveProperty('commandTimeout');
  });
});
