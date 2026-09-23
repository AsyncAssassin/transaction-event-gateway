import { ApiProperty } from '@nestjs/swagger';

import { PaymentIntentStatus } from '../../database/entities';
import { PaymentIntentResponse } from '../payment-intents.types';

export class PaymentIntentResponseDto implements PaymentIntentResponse {
  @ApiProperty({
    format: 'uuid',
    example: '5f70a0c2-7bb5-4545-b181-3fcff9b56b86',
  })
  id!: string;

  @ApiProperty({
    enum: PaymentIntentStatus,
    enumName: 'PaymentIntentStatus',
    description:
      'CREATED until the worker applies a matching confirmed webhook, then CONFIRMED. No code path sets PROCESSING, FAILED, or EXPIRED.',
    example: PaymentIntentStatus.Confirmed,
  })
  status!: PaymentIntentStatus;

  @ApiProperty({
    description:
      'Decimal string without leading zeros or trailing fractional zeros; "125.50" is returned as "125.5".',
    example: '125.5',
  })
  amount!: string;

  @ApiProperty({ example: 'USDC' })
  asset!: string;

  @ApiProperty({ example: 'wallet_test_123' })
  destination!: string;

  @ApiProperty({ type: String, nullable: true, example: 'order-1001' })
  reference!: string | null;

  @ApiProperty({ type: String, nullable: true, example: 'checkout-1001' })
  clientRequestId!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description:
      'Transaction hash of the webhook that confirmed the intent; null before confirmation.',
    example: '0xtest123',
  })
  confirmedTxHash!: string | null;

  @ApiProperty({ format: 'date-time', example: '2026-06-19T10:00:00.000Z' })
  createdAt!: string;

  @ApiProperty({
    format: 'date-time',
    description: 'Changes when the worker confirms the intent.',
    example: '2026-06-19T10:00:02.000Z',
  })
  updatedAt!: string;
}
