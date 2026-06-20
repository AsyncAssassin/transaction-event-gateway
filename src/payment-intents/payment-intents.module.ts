import { Module } from '@nestjs/common';

import { PaymentIntentsController } from './payment-intents.controller';
import { PaymentIntentsService } from './payment-intents.service';

@Module({
  controllers: [PaymentIntentsController],
  providers: [PaymentIntentsService],
})
export class PaymentIntentsModule {}
