import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Express } from 'express';
import { Server } from 'node:http';

import { httpRequestLoggingMiddleware } from './logging/http-request-logging.middleware';
import { CorrelationIdExceptionFilter } from './request-context/correlation-id-exception.filter';
import { correlationIdMiddleware } from './request-context/correlation-id.middleware';
import { requestBodyGuardMiddleware } from './validation/request-body-guard.middleware';
import { createValidationException } from './validation/validation-error-response';

const MAX_REQUEST_BODY_SIZE = '256kb';

// The AWS load balancer keeps idle connections to a target open for 60 s and
// reuses them, while Node closes an idle keep-alive connection after 5 s. A
// request sent on a connection that Node is closing fails with a 502, so idle
// connections stay open longer than the load balancer keeps them, and the
// header timeout stays above the keep-alive timeout.
export const KEEP_ALIVE_TIMEOUT_MS = 65_000;
export const HEADERS_TIMEOUT_MS = 66_000;

type BodyParserApplication = INestApplication & {
  useBodyParser(
    parser: 'json' | 'urlencoded',
    options: { limit?: string; extended?: boolean },
  ): INestApplication;
};

export function configureHttpApp(app: INestApplication): void {
  app.enableShutdownHooks();
  configureHttpServer(app);
  app.use(correlationIdMiddleware);
  app.use(httpRequestLoggingMiddleware);
  configureBodyParsers(app);
  app.use(requestBodyGuardMiddleware);
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

function configureHttpServer(app: INestApplication): void {
  const expressApp = app.getHttpAdapter().getInstance() as Express;
  expressApp.disable('x-powered-by');

  const server = app.getHttpServer() as Server;
  server.keepAliveTimeout = KEEP_ALIVE_TIMEOUT_MS;
  server.headersTimeout = HEADERS_TIMEOUT_MS;
}

// Nest registers any parser that is still missing during init(), after every
// middleware added here. Registering both parsers explicitly keeps them ahead
// of the body guard; the urlencoded options match Nest's defaults.
function configureBodyParsers(app: INestApplication): void {
  const bodyParserApp = app as BodyParserApplication;
  bodyParserApp.useBodyParser('json', { limit: MAX_REQUEST_BODY_SIZE });
  bodyParserApp.useBodyParser('urlencoded', { extended: true });
}
