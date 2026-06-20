import { ConfigService } from '@nestjs/config';

import {
  OutboxDispatchBatchResult,
  OutboxDispatcherService,
} from './outbox-dispatcher.service';
import { OutboxDispatcherRunnerService } from './outbox-dispatcher-runner.service';

describe('OutboxDispatcherRunnerService', () => {
  let dispatcher: Pick<OutboxDispatcherService, 'dispatchBatch'>;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    dispatcher = {
      dispatchBatch: jest.fn<Promise<OutboxDispatchBatchResult>, []>().mockResolvedValue({
        selected: 0,
        published: 0,
        failed: 0,
      }),
    };
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it('does not poll when disabled', async () => {
    const runner = createRunner({
      OUTBOX_DISPATCH_ENABLED: false,
      OUTBOX_DISPATCH_INTERVAL_MS: 10,
    });

    runner.onApplicationBootstrap();
    await jest.advanceTimersByTimeAsync(50);
    await runner.onApplicationShutdown();

    expect(dispatcher.dispatchBatch).not.toHaveBeenCalled();
  });

  it('dispatches on the configured interval', async () => {
    const runner = createRunner({
      OUTBOX_DISPATCH_ENABLED: true,
      OUTBOX_DISPATCH_INTERVAL_MS: 10,
    });

    runner.onApplicationBootstrap();
    await jest.advanceTimersByTimeAsync(10);
    await runner.onApplicationShutdown();

    expect(dispatcher.dispatchBatch).toHaveBeenCalledTimes(1);
  });

  function createRunner(
    values: Record<string, boolean | number>,
  ): OutboxDispatcherRunnerService {
    const configService = {
      get: jest.fn((key: string) => values[key]),
    } as unknown as ConfigService;

    return new OutboxDispatcherRunnerService(
      configService,
      dispatcher as OutboxDispatcherService,
    );
  }
});
