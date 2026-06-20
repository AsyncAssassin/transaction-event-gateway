import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';

import { createTypeOrmModuleOptions } from './typeorm-options';

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) =>
        createTypeOrmModuleOptions(
          configService.getOrThrow<string>('DATABASE_URL'),
        ),
    }),
  ],
})
export class DatabaseModule {}
