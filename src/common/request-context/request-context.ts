import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

export type RequestContext = {
  correlationId: string;
  requestId: string;
  startedAt: number;
};

const MAX_CORRELATION_ID_LENGTH = 255;
const SAFE_HEADER_VALUE_PATTERN = /^[\x21-\x7E]+$/;

const requestContextStorage = new AsyncLocalStorage<RequestContext>();

export function createRequestContext(
  inboundCorrelationId: string | undefined,
): RequestContext {
  return {
    correlationId: normalizeCorrelationId(inboundCorrelationId) ?? randomUUID(),
    requestId: randomUUID(),
    startedAt: Date.now(),
  };
}

export function runWithRequestContext<T>(
  context: RequestContext,
  callback: () => T,
): T {
  return requestContextStorage.run(context, callback);
}

export function getRequestContext(): RequestContext | undefined {
  return requestContextStorage.getStore();
}

export function getCorrelationId(): string | undefined {
  return getRequestContext()?.correlationId;
}

// Work that a request started later, such as publishing its outbox row or
// processing its job, runs under the request's correlation ID with a new
// requestId, so its log lines can be found by that ID. Without a valid ID the
// work runs without a context.
export function runWithCorrelationId<T>(
  correlationId: string | undefined,
  callback: () => T,
): T {
  if (normalizeCorrelationId(correlationId) === undefined) {
    return callback();
  }

  return runWithRequestContext(createRequestContext(correlationId), callback);
}

export function normalizeCorrelationId(
  value: string | undefined,
): string | undefined {
  const trimmed = value?.trim();

  if (
    !trimmed ||
    trimmed.length > MAX_CORRELATION_ID_LENGTH ||
    !SAFE_HEADER_VALUE_PATTERN.test(trimmed)
  ) {
    return undefined;
  }

  return trimmed;
}
