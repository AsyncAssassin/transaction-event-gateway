import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

export const OPENAPI_DOCUMENT_PATH = 'docs/openapi.json';

export function setupOpenApi(app: INestApplication): void {
  const config = new DocumentBuilder()
    .setTitle('transaction-event-gateway')
    .setDescription(
      'HTTP API documentation for the transaction event gateway service. ' +
        'Webhook signatures are computed over the raw request body, not over parsed JSON.',
    )
    .setVersion('0.1.0')
    .build();
  const document = SwaggerModule.createDocument(app, config);

  SwaggerModule.setup('docs', app, document, {
    jsonDocumentUrl: OPENAPI_DOCUMENT_PATH,
  });
}
