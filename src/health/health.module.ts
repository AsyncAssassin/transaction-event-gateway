import { Module } from '@nestjs/common';

import { HealthController } from './health.controller';
import { HealthService } from './health.service';
import { PostgresHealthCheckService } from './postgres-health-check.service';
import { RedisHealthCheckService } from './redis-health-check.service';

@Module({
  controllers: [HealthController],
  providers: [
    HealthService,
    PostgresHealthCheckService,
    RedisHealthCheckService,
  ],
})
export class HealthModule {}
