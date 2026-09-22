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
      dispatchBatch: jest
        .fn<Promise<OutboxDispatchBatchResult>, []>()
        .mockResolvedValue({
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

  it('backs off exponentially after consecutive failures and caps the cooldown at 30 seconds', async () => {
    const attemptTimes: number[] = [];
    (dispatcher.dispatchBatch as jest.Mock).mockImplementation(() => {
      attemptTimes.push(Date.now());
      return Promise.reject(new Error('DB_DOWN'));
    });
    const runner = createRunner({
      OUTBOX_DISPATCH_ENABLED: true,
      OUTBOX_DISPATCH_INTERVAL_MS: 10,
    });

    runner.onApplicationBootstrap();
    await jest.advanceTimersByTimeAsync(100_000);
    await runner.onApplicationShutdown();

    const gaps = attemptTimes
      .slice(1)
      .map((time, index) => time - attemptTimes[index]);
    expect(gaps).toEqual([1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000]);
  });

  it('clears the backoff after a successful dispatch', async () => {
    const attemptTimes: number[] = [];
    (dispatcher.dispatchBatch as jest.Mock).mockImplementation(() => {
      attemptTimes.push(Date.now());
      return attemptTimes.length <= 2
        ? Promise.reject(new Error('DB_DOWN'))
        : Promise.resolve({ selected: 0, published: 0, failed: 0 });
    });
    const runner = createRunner({
      OUTBOX_DISPATCH_ENABLED: true,
      OUTBOX_DISPATCH_INTERVAL_MS: 10,
    });

    runner.onApplicationBootstrap();
    await jest.advanceTimersByTimeAsync(3_050);
    await runner.onApplicationShutdown();

    // Two failures back off (1 s, then 2 s); after the success the runner is
    // back to polling every tick. Times are relative to the first attempt
    // because fake timers start from the real clock.
    const relativeTimes = attemptTimes
      .slice(0, 5)
      .map((time) => time - attemptTimes[0]);
    expect(relativeTimes).toEqual([0, 1_000, 3_000, 3_010, 3_020]);
  });

  it('keeps polling after a failure instead of stopping the interval', async () => {
    (dispatcher.dispatchBatch as jest.Mock)
      .mockRejectedValueOnce(new Error('DB_DOWN'))
      .mockResolvedValue({ selected: 0, published: 0, failed: 0 });
    const runner = createRunner({
      OUTBOX_DISPATCH_ENABLED: true,
      OUTBOX_DISPATCH_INTERVAL_MS: 10,
    });

    runner.onApplicationBootstrap();
    await jest.advanceTimersByTimeAsync(1_050);
    await runner.onApplicationShutdown();

    expect(dispatcher.dispatchBatch).toHaveBeenCalledTimes(6);
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
