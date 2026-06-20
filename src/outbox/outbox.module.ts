import { Module } from '@nestjs/common';

import { QueuesModule } from '../processing/queues.module';
import { OutboxDispatcherService } from './outbox-dispatcher.service';

@Module({
  imports: [QueuesModule],
  providers: [OutboxDispatcherService],
  exports: [OutboxDispatcherService],
})
export class OutboxModule {}
