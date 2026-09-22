// Diagnostics for logs that must not carry raw error messages: PostgreSQL and
// driver messages can embed request values. The name, a code that matches a
// strict pattern (SQLSTATE, errno, library code), and the top stack frames are
// enough to tell failures apart without echoing input.
const SAFE_ERROR_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
const SAFE_CAUSE_CODE_PATTERN = /^[A-Z0-9_]{1,64}$/;
const STACK_FRAME_PATTERN = /^\s*at\s/;
const NODE_INTERNAL_FRAME_PATTERN = /\(node:|at node:/;
const MAX_STACK_FRAMES = 3;
const MAX_CAUSE_DEPTH = 4;

export type ErrorDiagnostics = {
  errorName?: string;
  causeCode?: string;
  stackTop?: string;
};

export function describeError(error: unknown): ErrorDiagnostics {
  if (error === null || typeof error !== 'object') {
    return { errorName: 'NonErrorValue' };
  }

  const diagnostics: ErrorDiagnostics = {};
  const errorName = resolveErrorName(error);
  const causeCode = findCauseCode(error);
  const stackTop = extractStackTop(error);

  if (errorName) {
    diagnostics.errorName = errorName;
  }
  if (causeCode) {
    diagnostics.causeCode = causeCode;
  }
  if (stackTop) {
    diagnostics.stackTop = stackTop;
  }

  return diagnostics;
}

function resolveErrorName(error: object): string | undefined {
  const name = (error as { name?: unknown }).name;
  if (typeof name === 'string' && SAFE_ERROR_NAME_PATTERN.test(name)) {
    return name;
  }

  const constructorName = error.constructor?.name;
  return typeof constructorName === 'string' &&
    SAFE_ERROR_NAME_PATTERN.test(constructorName)
    ? constructorName
    : undefined;
}

// TypeORM wraps the pg error in driverError, Node wraps connection attempts in
// an AggregateError (errors), and libraries chain errors through cause.
function findCauseCode(error: unknown, depth = 0): string | undefined {
  if (depth > MAX_CAUSE_DEPTH || error === null || typeof error !== 'object') {
    return undefined;
  }

  const candidate = error as {
    code?: unknown;
    driverError?: unknown;
    cause?: unknown;
    errors?: unknown;
  };

  if (
    typeof candidate.code === 'string' &&
    SAFE_CAUSE_CODE_PATTERN.test(candidate.code)
  ) {
    return candidate.code;
  }

  const nested = [
    candidate.driverError,
    candidate.cause,
    ...(Array.isArray(candidate.errors) ? candidate.errors : []),
  ];

  for (const nestedError of nested) {
    const code = findCauseCode(nestedError, depth + 1);
    if (code) {
      return code;
    }
  }

  return undefined;
}

// The first lines of a stack repeat the message, possibly over several lines,
// so skip them before collecting frames.
function extractStackTop(error: object): string | undefined {
  const { stack, message } = error as { stack?: unknown; message?: unknown };
  if (typeof stack !== 'string') {
    return undefined;
  }

  const headerLineCount =
    typeof message === 'string' ? message.split('\n').length : 1;
  const frames = stack
    .split('\n')
    .slice(headerLineCount)
    .filter(
      (line) =>
        STACK_FRAME_PATTERN.test(line) &&
        !NODE_INTERNAL_FRAME_PATTERN.test(line),
    )
    .slice(0, MAX_STACK_FRAMES)
    .map((line) => line.trim());

  return frames.length > 0 ? frames.join(' | ') : undefined;
}
