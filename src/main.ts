import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

import { AppModule } from './app.module';
import { configureHttpApp } from './common/bootstrap';

function isSwaggerEnabled(): boolean {
  if (process.env.NODE_ENV !== 'production') {
    return true;
  }
  return process.env.SWAGGER_ENABLED === 'true';
}

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
    rawBody: true,
  });
  const logger = new Logger('Bootstrap');

  configureHttpApp(app);

  if (isSwaggerEnabled()) {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('transaction-event-gateway')
      .setDescription(
        'HTTP API documentation for the transaction event gateway service. ' +
          'Webhook signatures are computed over the raw request body, not over parsed JSON.',
      )
      .setVersion('0.1.0')
      .build();
    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('docs', app, document, {
      jsonDocumentUrl: 'docs/openapi.json',
    });
  }

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
  logger.log(`API process listening on port ${port}`);
}

void bootstrap();
