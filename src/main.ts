import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

import { AppModule } from './app.module';
import { configureHttpApp } from './common/bootstrap';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, {
    bufferLogs: true,
    rawBody: true,
  });
  const logger = new Logger('Bootstrap');

  configureHttpApp(app);

  const swaggerConfig = new DocumentBuilder()
    .setTitle('transaction-event-gateway')
    .setDescription('HTTP API documentation for the transaction event gateway service.')
    .setVersion('0.1.0')
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('docs', app, document, {
    jsonDocumentUrl: 'docs/openapi.json',
  });

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
  logger.log(`API process listening on port ${port}`);
}

void bootstrap();
