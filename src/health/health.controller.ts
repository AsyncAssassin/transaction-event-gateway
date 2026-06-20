import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { HealthService, LivenessResponse, ReadinessResponse } from './health.service';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get('live')
  @ApiOperation({
    operationId: 'getLiveness',
    summary: 'Check process liveness',
  })
  @ApiOkResponse({ description: 'The process is running.' })
  getLiveness(): LivenessResponse {
    return this.healthService.getLiveness();
  }

  @Get('ready')
  @ApiOperation({
    operationId: 'getReadiness',
    summary: 'Check service readiness',
  })
  @ApiOkResponse({
    description:
      'Required configuration is loaded, PostgreSQL accepts a lightweight query, and Redis accepts a ping.',
  })
  getReadiness(): Promise<ReadinessResponse> {
    return this.healthService.getReadiness();
  }
}
