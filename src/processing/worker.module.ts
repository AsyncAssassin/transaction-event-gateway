import { Module } from '@nestjs/common';

import { AppConfigModule } from '../config/config.module';
import { DatabaseModule } from '../database/database.module';
import { OutboxDispatcherRunnerService } from '../outbox/outbox-dispatcher-runner.service';
import { OutboxModule } from '../outbox/outbox.module';
import { ProcessingModule } from './processing.module';
import { QueuesModule } from './queues.module';
import { WebhookEventsWorkerService } from './webhook-events-worker.service';

@Module({
  imports: [
    AppConfigModule,
    DatabaseModule,
    QueuesModule,
    OutboxModule,
    ProcessingModule,
  ],
  providers: [WebhookEventsWorkerService, OutboxDispatcherRunnerService],
})
export class WorkerModule {}
