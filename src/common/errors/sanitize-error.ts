const MAX_SANITIZED_ERROR_LENGTH = 500;

export function sanitizeErrorMessage(
  error: unknown,
  fallback = 'UNKNOWN_ERROR',
): string {
  const rawMessage =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : fallback;

  const sanitized = rawMessage
    .replace(/[^\x20-\x7E]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_SANITIZED_ERROR_LENGTH);

  return sanitized.length > 0 ? sanitized : fallback;
}
