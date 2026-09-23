import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';

import { AppModule } from './app.module';
import { configureHttpApp } from './common/bootstrap';
import { createAppLogger } from './common/logging/app-logger';
import { setupOpenApi } from './common/openapi/openapi';

function isSwaggerEnabled(): boolean {
  if (process.env.NODE_ENV !== 'production') {
    return true;
  }
  return process.env.SWAGGER_ENABLED === 'true';
}

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: createAppLogger(),
    rawBody: true,
  });
  const logger = new Logger('Bootstrap');

  configureHttpApp(app);

  if (isSwaggerEnabled()) {
    setupOpenApi(app);
  }

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
  logger.log(`API process listening on port ${port}`);
}

void bootstrap();
