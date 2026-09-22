import {
  INestApplication,
  ValidationPipe,
} from '@nestjs/common';

import { httpRequestLoggingMiddleware } from './logging/http-request-logging.middleware';
import { CorrelationIdExceptionFilter } from './request-context/correlation-id-exception.filter';
import { correlationIdMiddleware } from './request-context/correlation-id.middleware';
import { createValidationException } from './validation/validation-error-response';

const MAX_REQUEST_BODY_SIZE = '256kb';

type JsonBodyParserApplication = INestApplication & {
  useBodyParser(parser: 'json', options: { limit: string }): INestApplication;
};

export function configureHttpApp(app: INestApplication): void {
  app.enableShutdownHooks();
  app.use(correlationIdMiddleware);
  app.use(httpRequestLoggingMiddleware);
  configureJsonBodyParser(app);
  app.useGlobalFilters(new CorrelationIdExceptionFilter());
  app.useGlobalPipes(
    new ValidationPipe({
      exceptionFactory: createValidationException,
      forbidNonWhitelisted: true,
      transform: true,
      whitelist: true,
    }),
  );
}

function configureJsonBodyParser(app: INestApplication): void {
  const bodyParserApp = app as JsonBodyParserApplication;
  bodyParserApp.useBodyParser('json', { limit: MAX_REQUEST_BODY_SIZE });
}
