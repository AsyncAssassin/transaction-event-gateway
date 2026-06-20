import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { WorkerModule } from './processing/worker.module';

async function bootstrapWorker(): Promise<void> {
  const app = await NestFactory.createApplicationContext(WorkerModule, {
    bufferLogs: true,
  });
  const logger = new Logger('WorkerBootstrap');

  app.enableShutdownHooks();
  logger.log('Worker process started and consuming webhook-events queue');
}

void bootstrapWorker();
