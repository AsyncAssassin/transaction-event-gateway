import { Module } from '@nestjs/common';

import { QueuesModule } from '../processing/queues.module';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';

@Module({
  imports: [QueuesModule],
  controllers: [HealthController],
  providers: [HealthService],
})
export class HealthModule {}
