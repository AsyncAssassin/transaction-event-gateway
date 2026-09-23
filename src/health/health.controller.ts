import { Controller, Get, HttpStatus } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';

import { ApiErrorResponses } from '../common/openapi/api-error-responses.decorator';
import {
  LivenessResponseDto,
  ReadinessResponseDto,
  ServingReadinessResponseDto,
} from './dto/health-response.dto';
import {
  HealthService,
  LivenessResponse,
  ReadinessResponse,
  ServingReadinessResponse,
} from './health.service';

@ApiTags('health')
@Controller('health')
@SkipThrottle()
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get('live')
  @ApiOperation({
    operationId: 'getLiveness',
    summary: 'Check process liveness',
  })
  @ApiOkResponse({
    description: 'The process is running.',
    type: LivenessResponseDto,
  })
  getLiveness(): LivenessResponse {
    return this.healthService.getLiveness();
  }

  @Get('ready')
  @ApiOperation({
    operationId: 'getReadiness',
    summary: 'Check full service readiness (config, PostgreSQL, Redis)',
  })
  @ApiOkResponse({
    description:
      'Required configuration is loaded, PostgreSQL accepts a lightweight query, and Redis accepts a ping.',
    type: ReadinessResponseDto,
  })
  @ApiErrorResponses({
    [HttpStatus.SERVICE_UNAVAILABLE]:
      'Required configuration is missing, or PostgreSQL or Redis failed its check (SERVICE_UNAVAILABLE); details name the configuration key or the dependency.',
  })
  getReadiness(): Promise<ReadinessResponse> {
    return this.healthService.getReadiness();
  }

  @Get('serving')
  @ApiOperation({
    operationId: 'getServingReadiness',
    summary:
      'Check serving readiness for load balancer routing (config, PostgreSQL)',
  })
  @ApiOkResponse({
    description:
      'Required configuration is loaded and PostgreSQL accepts a lightweight query. Redis is intentionally excluded so a Redis incident does not remove API tasks that can still serve PostgreSQL-only operations.',
    type: ServingReadinessResponseDto,
  })
  @ApiErrorResponses({
    [HttpStatus.SERVICE_UNAVAILABLE]:
      'Required configuration is missing or PostgreSQL failed its check (SERVICE_UNAVAILABLE); details name the configuration key or the dependency.',
  })
  getServingReadiness(): Promise<ServingReadinessResponse> {
    return this.healthService.getServingReadiness();
  }
}
