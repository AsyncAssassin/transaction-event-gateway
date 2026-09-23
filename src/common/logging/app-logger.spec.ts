import { Logger } from '@nestjs/common';

import {
  createAppLogger,
  JsonLogger,
  resolveLogFormat,
  TextLogger,
} from './app-logger';
import { StructuredLogger } from './structured-logger';

type WriteSpy = jest.SpyInstance<
  boolean,
  Parameters<typeof process.stdout.write>
>;

function captureWrites(): { stdout: WriteSpy; stderr: WriteSpy } {
  return {
    stdout: jest.spyOn(process.stdout, 'write').mockImplementation(() => true),
    stderr: jest.spyOn(process.stderr, 'write').mockImplementation(() => true),
  };
}

function writtenLines(spy: WriteSpy): string[] {
  return spy.mock.calls.map(([chunk]) => String(chunk));
}

describe('resolveLogFormat', () => {
  it.each([
    [{}, 'text'],
    [{ NODE_ENV: 'development' }, 'text'],
    [{ NODE_ENV: 'test' }, 'text'],
    [{ NODE_ENV: 'production' }, 'json'],
    [{ NODE_ENV: 'development', LOG_FORMAT: 'json' }, 'json'],
    [{ NODE_ENV: 'production', LOG_FORMAT: 'text' }, 'text'],
  ])('resolves %j to %s', (env, format) => {
    expect(resolveLogFormat(env as NodeJS.ProcessEnv)).toBe(format);
  });

  it('creates the logger for the format', () => {
    expect(createAppLogger('json')).toBeInstanceOf(JsonLogger);
    expect(createAppLogger('text')).toBeInstanceOf(TextLogger);
  });
});

describe('JsonLogger', () => {
  let writes: ReturnType<typeof captureWrites>;

  beforeEach(() => {
    writes = captureWrites();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('prints a structured event as one JSON line with its fields at the top level', () => {
    new JsonLogger().log(
      {
        event: 'webhook_accepted',
        correlationId: 'corr-1',
        status: 'ACCEPTED',
      },
      'WebhookEventsService',
    );

    const lines = writtenLines(writes.stdout);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^\{.*\}\n$/);
    expect(lines[0]).not.toContain('\u001b[');
    expect(JSON.parse(lines[0]!)).toEqual({
      timestamp: expect.stringMatching(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
      ),
      level: 'info',
      context: 'WebhookEventsService',
      event: 'webhook_accepted',
      correlationId: 'corr-1',
      status: 'ACCEPTED',
    });
  });

  it('keeps a plain message under "message" and names Nest levels', () => {
    const logger = new JsonLogger();

    logger.warn('Mapped route', 'RoutesResolver');

    expect(JSON.parse(writtenLines(writes.stdout)[0]!)).toEqual({
      timestamp: expect.any(String),
      level: 'warn',
      context: 'RoutesResolver',
      message: 'Mapped route',
    });
  });

  it('writes errors with their stack to stderr', () => {
    new JsonLogger().error(
      'Connection lost',
      'Error: Connection lost\n    at connect (db.js:1:1)',
      'ExceptionHandler',
    );

    expect(writtenLines(writes.stdout)).toHaveLength(0);
    expect(JSON.parse(writtenLines(writes.stderr)[0]!)).toEqual({
      timestamp: expect.any(String),
      level: 'error',
      context: 'ExceptionHandler',
      message: 'Connection lost',
      stack: 'Error: Connection lost\n    at connect (db.js:1:1)',
    });
  });

  it('does not let event fields replace the timestamp, level, or context', () => {
    new JsonLogger().log(
      { event: 'x', level: 'fatal', context: 'Other' },
      'Ctx',
    );

    expect(JSON.parse(writtenLines(writes.stdout)[0]!)).toMatchObject({
      level: 'info',
      context: 'Ctx',
      event: 'x',
    });
  });

  it('prints StructuredLogger events through the Nest logger', () => {
    Logger.overrideLogger(new JsonLogger());

    new StructuredLogger('OutboxDispatcherService').info(
      'outbox_dispatch_published',
      { webhookEventId: 'wh-1', status: 'PUBLISHED' },
    );

    expect(JSON.parse(writtenLines(writes.stdout)[0]!)).toEqual({
      timestamp: expect.any(String),
      level: 'info',
      context: 'OutboxDispatcherService',
      event: 'outbox_dispatch_published',
      webhookEventId: 'wh-1',
      status: 'PUBLISHED',
    });
  });
});

describe('TextLogger', () => {
  const previousNoColor = process.env.NO_COLOR;
  let writes: ReturnType<typeof captureWrites>;

  beforeEach(() => {
    process.env.NO_COLOR = '1';
    writes = captureWrites();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    if (previousNoColor === undefined) {
      delete process.env.NO_COLOR;
    } else {
      process.env.NO_COLOR = previousNoColor;
    }
  });

  it('prints a structured event as compact JSON after the Nest prefix', () => {
    new TextLogger().log(
      { event: 'webhook_accepted', status: 'ACCEPTED' },
      'Ctx',
    );

    const [line] = writtenLines(writes.stdout);
    expect(line).toMatch(
      /^\[Nest\] \d+ {2}- .+ {5}LOG \[Ctx\] \{"event":"webhook_accepted","status":"ACCEPTED"\}\n$/,
    );
  });

  it('prints plain messages unchanged', () => {
    new TextLogger().log('API process listening on port 3000', 'Bootstrap');

    expect(writtenLines(writes.stdout)[0]).toContain(
      '[Bootstrap] API process listening on port 3000',
    );
  });
});
