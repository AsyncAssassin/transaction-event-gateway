import { setTestEnvDefaults } from './test-env';

export default async function setupE2eDatabase(): Promise<void> {
  setTestEnvDefaults();
  await assertNoOtherQueueWorkers();

  const { default: dataSource } = await import('../src/database/data-source');

  try {
    if (!dataSource.isInitialized) {
      await dataSource.initialize();
    }

    await dataSource.runMigrations();
  } finally {
    if (dataSource.isInitialized) {
      await dataSource.destroy();
    }
  }
}

// The suite truncates the local tables and publishes and consumes jobs on the
// shared queue. A worker that is already running against the same Redis, such
// as the Docker Compose worker, takes those jobs and makes tests fail at
// random, so refuse to start instead.
async function assertNoOtherQueueWorkers(): Promise<void> {
  const { Queue } = await import('bullmq');
  const { WEBHOOK_EVENTS_QUEUE_NAME } =
    await import('../src/processing/queue.constants');
  const { createQueueRedisConnectionOptions } =
    await import('../src/processing/redis-options');
  const redisUrl = process.env.REDIS_URL ?? '';
  const queue = new Queue(WEBHOOK_EVENTS_QUEUE_NAME, {
    connection: createQueueRedisConnectionOptions(redisUrl),
  });

  try {
    const workers = await queue.getWorkers();

    if (workers.length > 0) {
      throw new Error(
        `${workers.length} BullMQ worker(s) are already consuming the ` +
          `"${WEBHOOK_EVENTS_QUEUE_NAME}" queue on ${new URL(redisUrl).host}. ` +
          'Stop them before running the e2e suite, for example with ' +
          '`docker compose stop api worker`; the suite also truncates the ' +
          'tables of the local database.',
      );
    }
  } finally {
    await queue.close();
  }
}
