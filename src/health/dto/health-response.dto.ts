import { ApiProperty } from '@nestjs/swagger';

import {
  LivenessResponse,
  ReadinessResponse,
  ServingReadinessResponse,
} from '../health.service';

export class LivenessResponseDto implements LivenessResponse {
  @ApiProperty({ enum: ['ok'], example: 'ok' })
  status!: 'ok';

  @ApiProperty({ format: 'date-time', example: '2026-06-19T10:00:00.000Z' })
  timestamp!: string;

  @ApiProperty({ type: 'integer', example: 42 })
  uptimeSeconds!: number;
}

export class ServingReadinessChecksDto {
  @ApiProperty({ enum: ['ok'], example: 'ok' })
  config!: 'ok';

  @ApiProperty({ enum: ['ok'], example: 'ok' })
  postgres!: 'ok';
}

export class ReadinessChecksDto extends ServingReadinessChecksDto {
  @ApiProperty({ enum: ['ok'], example: 'ok' })
  redis!: 'ok';
}

export class ReadinessResponseDto implements ReadinessResponse {
  @ApiProperty({ enum: ['ready'], example: 'ready' })
  status!: 'ready';

  @ApiProperty({ format: 'date-time', example: '2026-06-19T10:00:00.000Z' })
  timestamp!: string;

  @ApiProperty({ type: ReadinessChecksDto })
  checks!: ReadinessChecksDto;
}

export class ServingReadinessResponseDto implements ServingReadinessResponse {
  @ApiProperty({ enum: ['ready'], example: 'ready' })
  status!: 'ready';

  @ApiProperty({ format: 'date-time', example: '2026-06-19T10:00:00.000Z' })
  timestamp!: string;

  @ApiProperty({ type: ServingReadinessChecksDto })
  checks!: ServingReadinessChecksDto;
}
