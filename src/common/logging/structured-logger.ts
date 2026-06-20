import { HttpException, Logger } from '@nestjs/common';

import { getRequestContext } from '../request-context/request-context';

export type StructuredLogField =
  | 'correlationId'
  | 'requestId'
  | 'paymentIntentId'
  | 'webhookEventId'
  | 'externalEventId'
  | 'provider'
  | 'jobId'
  | 'status'
  | 'errorCode'
  | 'method'
  | 'path'
  | 'durationMs';

export type StructuredLogFields = Partial<Record<StructuredLogField, unknown>>;

const ALLOWED_LOG_FIELDS = new Set<StructuredLogField>([
  'correlationId',
  'requestId',
  'paymentIntentId',
  'webhookEventId',
  'externalEventId',
  'provider',
  'jobId',
  'status',
  'errorCode',
  'method',
  'path',
  'durationMs',
]);

const MAX_LOG_STRING_LENGTH = 500;
const SAFE_ERROR_CODE_PATTERN = /^[A-Z0-9_:-]{1,128}$/;

export class StructuredLogger {
  private readonly logger: Logger;

  constructor(context: string) {
    this.logger = new Logger(context);
  }

  info(event: string, fields: StructuredLogFields = {}): void {
    this.logger.log(JSON.stringify(createStructuredLogEntry(event, fields)));
  }

  warn(event: string, fields: StructuredLogFields = {}): void {
    this.logger.warn(JSON.stringify(createStructuredLogEntry(event, fields)));
  }

  error(event: string, fields: StructuredLogFields = {}): void {
    this.logger.error(JSON.stringify(createStructuredLogEntry(event, fields)));
  }
}

export function createStructuredLogEntry(
  event: string,
  fields: StructuredLogFields = {},
): Record<string, string | number | boolean | null> {
  const requestContext = getRequestContext();
  const entry: Record<string, string | number | boolean | null> = {
    event: sanitizeString(event),
  };

  if (requestContext) {
    entry.correlationId = requestContext.correlationId;
    entry.requestId = requestContext.requestId;
  }

  for (const [key, value] of Object.entries(fields)) {
    if (!ALLOWED_LOG_FIELDS.has(key as StructuredLogField)) {
      continue;
    }

    const normalizedValue = normalizeLogValue(value);

    if (normalizedValue !== undefined) {
      entry[key] = normalizedValue;
    }
  }

  return entry;
}

export function toSafeErrorCode(error: unknown, fallback: string): string {
  const exceptionErrorCode = getHttpExceptionErrorCode(error);

  if (exceptionErrorCode) {
    return exceptionErrorCode;
  }

  const message = error instanceof Error ? error.message : undefined;

  if (message && SAFE_ERROR_CODE_PATTERN.test(message)) {
    return message;
  }

  return fallback;
}

function getHttpExceptionErrorCode(error: unknown): string | undefined {
  if (!(error instanceof HttpException)) {
    return undefined;
  }

  const response = error.getResponse();

  if (typeof response !== 'object' || response === null) {
    return undefined;
  }

  const errorCode = (response as { error?: unknown }).error;

  return typeof errorCode === 'string' && SAFE_ERROR_CODE_PATTERN.test(errorCode)
    ? errorCode
    : undefined;
}

function normalizeLogValue(
  value: unknown,
): string | number | boolean | null | undefined {
  if (value === null) {
    return null;
  }

  if (typeof value === 'string') {
    return sanitizeString(value);
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'boolean') {
    return value;
  }

  return undefined;
}

function sanitizeString(value: string): string {
  return value
    .replace(/[^\x20-\x7E]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_LOG_STRING_LENGTH);
}
