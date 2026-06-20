import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { envValidationSchema } from './env.validation';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validationOptions: {
        abortEarly: false,
      },
      validationSchema: envValidationSchema,
    }),
  ],
})
export class AppConfigModule {}
