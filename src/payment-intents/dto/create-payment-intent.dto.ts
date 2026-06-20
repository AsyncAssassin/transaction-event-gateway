import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsNotEmpty,
  IsObject,
  IsString,
  Matches,
  MaxLength,
  ValidateIf,
} from 'class-validator';

import { IsPaymentAmount } from '../validation/payment-amount.validator';

export class CreatePaymentIntentDto {
  @ApiProperty({
    description: 'Positive decimal string that fits numeric(36,18).',
    example: '125.50',
  })
  @IsPaymentAmount()
  amount!: string;

  @ApiProperty({
    description: 'Uppercase asset code.',
    example: 'USDC',
    maxLength: 32,
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(32)
  @Matches(/^[A-Z0-9][A-Z0-9._:-]*$/)
  asset!: string;

  @ApiProperty({
    example: 'wallet_test_123',
    maxLength: 255,
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  destination!: string;

  @ApiPropertyOptional({
    example: 'order-1001',
    maxLength: 255,
  })
  @ValidateIf((_, value: unknown) => value !== undefined)
  @IsString()
  @MaxLength(255)
  reference?: string;

  @ApiPropertyOptional({
    example: 'checkout-1001',
    maxLength: 255,
  })
  @ValidateIf((_, value: unknown) => value !== undefined)
  @IsString()
  @MaxLength(255)
  clientRequestId?: string;

  @ApiPropertyOptional({
    description: 'Optional JSON object for caller-owned metadata.',
    default: {},
    example: { customerId: 'cust_123' },
  })
  @ValidateIf((_, value: unknown) => value !== undefined)
  @IsObject()
  metadata: Record<string, unknown> = {};
}
