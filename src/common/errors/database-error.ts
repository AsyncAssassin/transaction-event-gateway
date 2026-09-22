const DATABASE_UNAVAILABLE_CODES = new Set<string>([
  // PostgreSQL SQLSTATE class 08 — connection exception.
  '08000',
  '08001',
  '08003',
  '08004',
  '08006',
  '08007',
  '08P01',
  // PostgreSQL SQLSTATE class 57 — operator intervention.
  '57P01',
  '57P02',
  '57P03',
  // Too many connections.
  '53300',
  // Node socket-level connection errors.
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'ENOTFOUND',
  'EPIPE',
  'EHOSTUNREACH',
]);

const DATABASE_UNAVAILABLE_MESSAGES = new Set<string>([
  'timeout exceeded when trying to connect',
  'connection terminated due to connection timeout',
  'connection terminated unexpectedly',
  'client has encountered a connection error and is not queryable',
]);

function collectErrorCodes(error: unknown, depth = 0): string[] {
  if (depth > 4 || error === null || typeof error !== 'object') {
    return [];
  }

  const candidate = error as {
    code?: unknown;
    driverError?: unknown;
    cause?: unknown;
    errors?: unknown;
  };
  const codes: string[] = [];

  if (typeof candidate.code === 'string') {
    codes.push(candidate.code);
  }
  codes.push(...collectErrorCodes(candidate.driverError, depth + 1));
  codes.push(...collectErrorCodes(candidate.cause, depth + 1));

  if (Array.isArray(candidate.errors)) {
    for (const nested of candidate.errors) {
      codes.push(...collectErrorCodes(nested, depth + 1));
    }
  }

  return codes;
}

function collectErrorMessages(error: unknown, depth = 0): string[] {
  if (depth > 4 || error === null || typeof error !== 'object') {
    return [];
  }

  const candidate = error as {
    message?: unknown;
    driverError?: unknown;
    cause?: unknown;
    errors?: unknown;
  };
  const messages: string[] = [];

  if (typeof candidate.message === 'string') {
    messages.push(candidate.message);
  }
  messages.push(...collectErrorMessages(candidate.driverError, depth + 1));
  messages.push(...collectErrorMessages(candidate.cause, depth + 1));

  if (Array.isArray(candidate.errors)) {
    for (const nested of candidate.errors) {
      messages.push(...collectErrorMessages(nested, depth + 1));
    }
  }

  return messages;
}

function normalizeUnavailableMessage(message: string): string {
  return message.trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * Detects errors that mean a required datastore (PostgreSQL) is temporarily
 * unreachable, so callers can return 503 instead of a generic 500. The match is
 * intentionally narrow: only connection-class codes and known pg/pg-pool
 * codeless connectivity messages qualify. Integrity errors (for example 23505
 * unique violations) are not treated as unavailability.
 */
export function isDatabaseUnavailableError(error: unknown): boolean {
  const hasUnavailableCode = collectErrorCodes(error).some((code) =>
    DATABASE_UNAVAILABLE_CODES.has(code),
  );

  if (hasUnavailableCode) {
    return true;
  }

  return collectErrorMessages(error).some((message) =>
    DATABASE_UNAVAILABLE_MESSAGES.has(normalizeUnavailableMessage(message)),
  );
}
