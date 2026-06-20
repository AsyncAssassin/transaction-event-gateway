import {
  INestApplication,
  ValidationPipe,
} from '@nestjs/common';

import { httpRequestLoggingMiddleware } from './logging/http-request-logging.middleware';
import { CorrelationIdExceptionFilter } from './request-context/correlation-id-exception.filter';
import { correlationIdMiddleware } from './request-context/correlation-id.middleware';
import { createValidationException } from './validation/validation-error-response';

export function configureHttpApp(app: INestApplication): void {
  app.enableShutdownHooks();
  app.use(correlationIdMiddleware);
  app.use(httpRequestLoggingMiddleware);
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
