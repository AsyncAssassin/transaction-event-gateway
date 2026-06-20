import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsNotEmpty,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  ValidateIf,
} from 'class-validator';

import { IsPaymentAmount } from '../../payment-intents/validation/payment-amount.validator';

export class BlockchainWebhookDto {
  @ApiProperty({
    example: 'evt_123',
    maxLength: 255,
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  eventId!: string;

  @ApiProperty({
    example: 'transaction.confirmed',
    maxLength: 128,
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  type!: string;

  @ApiProperty({
    example: '5f70a0c2-7bb5-4545-b181-3fcff9b56b86',
  })
  @IsUUID()
  paymentIntentId!: string;

  @ApiPropertyOptional({
    example: '0xtest123',
    maxLength: 255,
  })
  @ValidateIf(
    (dto: BlockchainWebhookDto, value: unknown) =>
      value !== undefined || dto.type === 'transaction.confirmed',
  )
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  txHash?: string;

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
}
