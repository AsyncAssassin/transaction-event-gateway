import { BadRequestException } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';

// JSON.parse and the urlencoded parser accept values that fail much later:
// PostgreSQL rejects NUL characters and unpaired surrogates (a 500 instead of
// a 400), class-transformer overflows the call stack on deeply nested objects
// before any validator runs, and keys named after Object.prototype members
// slip past the whitelist check. Reject such bodies before they reach routing.
export const MAX_REQUEST_BODY_DEPTH = 32;

const RESERVED_KEYS = new Set<string>([
  ...Object.getOwnPropertyNames(Object.prototype),
  'prototype',
]);

const VIOLATION_MESSAGES = {
  depth: `Request body must not be nested deeper than ${MAX_REQUEST_BODY_DEPTH} levels.`,
  controlCharacter:
    'Request body must not contain control characters other than tab, line feed, and carriage return.',
  loneSurrogate: 'Request body must not contain unpaired UTF-16 surrogates.',
  reservedKey:
    'Request body must not use reserved property names such as __proto__, constructor, or prototype.',
} as const;

type RequestBodyViolation = keyof typeof VIOLATION_MESSAGES;

// Iterative on purpose: a recursive walk would hit the same stack overflow
// this guard exists to prevent.
export function findRequestBodyViolation(
  body: unknown,
): RequestBodyViolation | null {
  if (typeof body === 'string') {
    return findStringViolation(body);
  }

  const pending: Array<{ value: unknown; depth: number }> = [
    { value: body, depth: 1 },
  ];

  while (pending.length > 0) {
    const { value, depth } = pending.pop()!;

    if (typeof value !== 'object' || value === null) {
      continue;
    }

    if (depth > MAX_REQUEST_BODY_DEPTH) {
      return 'depth';
    }

    const entries: Array<[string | null, unknown]> = Array.isArray(value)
      ? value.map((item) => [null, item])
      : Object.entries(value);

    for (const [key, child] of entries) {
      if (key !== null) {
        if (RESERVED_KEYS.has(key)) {
          return 'reservedKey';
        }

        const keyViolation = findStringViolation(key);
        if (keyViolation) {
          return keyViolation;
        }
      }

      if (typeof child === 'string') {
        const valueViolation = findStringViolation(child);
        if (valueViolation) {
          return valueViolation;
        }
      } else if (typeof child === 'object' && child !== null) {
        pending.push({ value: child, depth: depth + 1 });
      }
    }
  }

  return null;
}

export function requestBodyGuardMiddleware(
  request: Request,
  _response: Response,
  next: NextFunction,
): void {
  const violation = findRequestBodyViolation(request.body);

  if (violation) {
    next(
      new BadRequestException({
        error: 'VALIDATION_ERROR',
        message: VIOLATION_MESSAGES[violation],
      }),
    );
    return;
  }

  next();
}

function findStringViolation(
  value: string,
): 'controlCharacter' | 'loneSurrogate' | null {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);

    if (code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) {
      return 'controlCharacter';
    }

    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        index += 1;
        continue;
      }
      return 'loneSurrogate';
    }

    if (code >= 0xdc00 && code <= 0xdfff) {
      return 'loneSurrogate';
    }
  }

  return null;
}
