import { ConsoleLogger, LogLevel } from '@nestjs/common';

export type LogFormat = 'json' | 'text';

// JSON lines for production images and Docker Compose, where logs are
// collected and filtered by field; colored text for local development.
export function resolveLogFormat(
  env: NodeJS.ProcessEnv = process.env,
): LogFormat {
  if (env.LOG_FORMAT === 'json' || env.LOG_FORMAT === 'text') {
    return env.LOG_FORMAT;
  }

  return env.NODE_ENV === 'production' ? 'json' : 'text';
}

export function createAppLogger(
  format: LogFormat = resolveLogFormat(),
): ConsoleLogger {
  return format === 'json' ? new JsonLogger() : new TextLogger();
}

type PrintOptions = {
  context: string;
  logLevel: LogLevel;
  writeStreamType?: 'stdout' | 'stderr';
  errorStack?: unknown;
};

const LEVEL_NAMES: Record<LogLevel, string> = {
  verbose: 'verbose',
  debug: 'debug',
  log: 'info',
  warn: 'warn',
  error: 'error',
  fatal: 'fatal',
};

/**
 * Prints one JSON object per line: timestamp, level and context, then the
 * fields of a structured log event, or a plain message under "message". Nest's
 * own JSON mode nests objects under "message" and prints epoch milliseconds.
 */
export class JsonLogger extends ConsoleLogger {
  constructor() {
    super({ json: true, colors: false });
  }

  protected printAsJson(message: unknown, options: PrintOptions): void {
    const record: Record<string, unknown> = {
      timestamp: new Date().toISOString(),
      level: LEVEL_NAMES[options.logLevel] ?? options.logLevel,
    };

    if (options.context) {
      record.context = options.context;
    }

    if (isPlainObject(message)) {
      for (const [key, value] of Object.entries(message)) {
        if (!(key in record)) {
          record[key] = value;
        }
      }
    } else {
      record.message = message instanceof Error ? message.message : message;
    }

    const stack =
      options.errorStack ?? (message instanceof Error ? message.stack : null);
    if (stack) {
      record.stack = stack;
    }

    const line = JSON.stringify(record, (key, value: unknown) =>
      this.stringifyReplacer(key, value),
    );
    process[options.writeStreamType ?? 'stdout'].write(`${line}\n`);
  }
}

/**
 * Nest's console format. A structured log event is printed as one line of
 * compact JSON after the usual prefix instead of an inspected object.
 */
export class TextLogger extends ConsoleLogger {
  constructor() {
    super({});
  }

  protected stringifyMessage(message: unknown, logLevel: LogLevel): unknown {
    return super.stringifyMessage(
      isPlainObject(message) ? JSON.stringify(message) : message,
      logLevel,
    );
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value) as unknown;

  return prototype === Object.prototype || prototype === null;
}
