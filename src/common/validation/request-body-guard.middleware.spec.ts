import { BadRequestException } from '@nestjs/common';
import { Request, Response } from 'express';

import {
  findRequestBodyViolation,
  MAX_REQUEST_BODY_DEPTH,
  requestBodyGuardMiddleware,
} from './request-body-guard.middleware';

function nest(depth: number): unknown {
  let value: unknown = 'leaf';
  for (let level = 0; level < depth; level += 1) {
    value = { a: value };
  }
  return value;
}

describe('findRequestBodyViolation', () => {
  it('accepts ordinary JSON, including tab, line feed, carriage return, and surrogate pairs', () => {
    expect(
      findRequestBodyViolation({
        amount: '125.50',
        metadata: {
          note: 'line one\nline two\r\n\tindented',
          emoji: 'paid 💸',
          tags: ['a', { b: 1 }],
        },
      }),
    ).toBeNull();
  });

  it('allows exactly the maximum depth and rejects one level more', () => {
    expect(findRequestBodyViolation(nest(MAX_REQUEST_BODY_DEPTH))).toBeNull();
    expect(findRequestBodyViolation(nest(MAX_REQUEST_BODY_DEPTH + 1))).toBe(
      'depth',
    );
  });

  it('counts arrays as nesting levels', () => {
    let value: unknown = 'leaf';
    for (let level = 0; level <= MAX_REQUEST_BODY_DEPTH; level += 1) {
      value = [value];
    }

    expect(findRequestBodyViolation(value)).toBe('depth');
  });

  it('walks very deep bodies without overflowing the call stack', () => {
    expect(findRequestBodyViolation(nest(100_000))).toBe('depth');
  });

  it.each([
    ['NUL in a value', { destination: 'wallet\u0000x' }],
    ['escape character in a nested value', { metadata: { a: '\u001b[31m' } }],
    ['control character in a key', { metadata: { 'a\u0000b': 'x' } }],
    ['control character in an array item', { list: ['ok', '\u0007'] }],
  ])('rejects a %s', (_, body) => {
    expect(findRequestBodyViolation(body)).toBe('controlCharacter');
  });

  it.each([
    ['lone high surrogate', { metadata: { a: '\ud800' } }],
    ['lone low surrogate', { destination: 'w\udc00' }],
    ['high surrogate at the end of a string', { destination: 'abc\ud83d' }],
    ['lone surrogate in a key', { metadata: { '\ud800': 'x' } }],
  ])('rejects a %s', (_, body) => {
    expect(findRequestBodyViolation(body)).toBe('loneSurrogate');
  });

  it.each(['__proto__', 'constructor', 'prototype', 'toString', 'valueOf'])(
    'rejects the reserved key %s at any depth',
    (key) => {
      expect(findRequestBodyViolation(JSON.parse(`{"${key}":1}`))).toBe(
        'reservedKey',
      );
      expect(
        findRequestBodyViolation(JSON.parse(`{"metadata":{"${key}":{}}}`)),
      ).toBe('reservedKey');
    },
  );

  it('ignores bodies that are not objects or strings', () => {
    expect(findRequestBodyViolation(undefined)).toBeNull();
    expect(findRequestBodyViolation(null)).toBeNull();
    expect(findRequestBodyViolation(42)).toBeNull();
  });
});

describe('requestBodyGuardMiddleware', () => {
  it('passes a valid body to the next handler', () => {
    const next = jest.fn();

    requestBodyGuardMiddleware(
      { body: { amount: '1' } } as Request,
      {} as Response,
      next,
    );

    expect(next).toHaveBeenCalledWith();
  });

  it('forwards a VALIDATION_ERROR BadRequestException for a rejected body', () => {
    const next = jest.fn();

    requestBodyGuardMiddleware(
      { body: { destination: 'a\u0000b' } } as Request,
      {} as Response,
      next,
    );

    const error = next.mock.calls[0]?.[0] as BadRequestException;
    expect(error).toBeInstanceOf(BadRequestException);
    expect(error.getResponse()).toEqual({
      error: 'VALIDATION_ERROR',
      message:
        'Request body must not contain control characters other than tab, line feed, and carriage return.',
    });
  });
});
