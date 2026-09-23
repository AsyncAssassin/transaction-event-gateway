import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ErrorDetailDto {
  @ApiPropertyOptional({
    description:
      'Request field or configuration key the detail refers to, as a dotted path.',
    example: 'amount',
  })
  field?: string;

  @ApiPropertyOptional({
    description: 'Constraint that the field breaks.',
    example: 'amount must be a decimal string greater than zero',
  })
  message?: string;

  @ApiPropertyOptional({
    description: 'Dependency that failed a readiness check.',
    example: 'postgres',
  })
  dependency?: string;
}

export class ErrorResponseDto {
  @ApiProperty({
    description: 'Stable error code.',
    example: 'VALIDATION_ERROR',
  })
  error!: string;

  @ApiProperty({
    description:
      'Human-readable explanation; clients should branch on error, not on this text.',
    example: 'Request validation failed.',
  })
  message!: string;

  @ApiPropertyOptional({
    type: [ErrorDetailDto],
    description: 'Field-level details, present on some errors.',
  })
  details?: ErrorDetailDto[];

  @ApiProperty({
    description:
      'Correlation ID of the request, also sent in X-Correlation-ID.',
    example: '8f1c0a4e-2c55-4c1b-9a53-3f5e2b1c7d90',
  })
  correlationId!: string;
}
