import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';

import { WorkerModule } from './processing/worker.module';

async function bootstrapWorker(): Promise<void> {
  const app = await NestFactory.createApplicationContext(WorkerModule, {
    bufferLogs: true,
  });
  // A standalone application context never auto-flushes buffered logs (only
  // listen() and useLogger() do), so flush explicitly. Otherwise the worker
  // stays silent and the log buffer grows for the lifetime of the process.
  app.flushLogs();
  const logger = new Logger('WorkerBootstrap');

  app.enableShutdownHooks();
  logger.log('Worker process started and consuming webhook-events queue');
}

void bootstrapWorker();
