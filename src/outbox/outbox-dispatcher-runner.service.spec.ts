import { ConfigService } from '@nestjs/config';

import { StructuredLogger } from '../common/logging/structured-logger';
import {
  OutboxDispatchBatchResult,
  OutboxDispatcherService,
  OutboxReconcileResult,
} from './outbox-dispatcher.service';
import { OutboxDispatcherRunnerService } from './outbox-dispatcher-runner.service';

describe('OutboxDispatcherRunnerService', () => {
  let dispatcher: Pick<
    OutboxDispatcherService,
    'dispatchBatch' | 'reconcileStalePublishedEvents'
  >;

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
      reconcileStalePublishedEvents: jest
        .fn<Promise<OutboxReconcileResult>, []>()
        .mockResolvedValue({ requeued: 0 }),
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

  it('reconciles stale published outbox rows once a minute', async () => {
    const runner = createRunner({
      OUTBOX_DISPATCH_ENABLED: true,
      OUTBOX_DISPATCH_INTERVAL_MS: 10,
    });

    runner.onApplicationBootstrap();
    await jest.advanceTimersByTimeAsync(59_999);
    expect(dispatcher.reconcileStalePublishedEvents).not.toHaveBeenCalled();

    await jest.advanceTimersByTimeAsync(1);
    expect(dispatcher.reconcileStalePublishedEvents).toHaveBeenCalledTimes(1);
    expect(dispatcher.reconcileStalePublishedEvents).toHaveBeenCalledWith();

    await jest.advanceTimersByTimeAsync(60_000);
    await runner.onApplicationShutdown();

    expect(dispatcher.reconcileStalePublishedEvents).toHaveBeenCalledTimes(2);
  });

  it('does not reconcile when disabled', async () => {
    const runner = createRunner({
      OUTBOX_DISPATCH_ENABLED: false,
      OUTBOX_DISPATCH_INTERVAL_MS: 10,
    });

    runner.onApplicationBootstrap();
    await jest.advanceTimersByTimeAsync(180_000);
    await runner.onApplicationShutdown();

    expect(dispatcher.reconcileStalePublishedEvents).not.toHaveBeenCalled();
  });

  it('logs a failed reconcile run and tries again on the next interval', async () => {
    const warnSpy = jest
      .spyOn(StructuredLogger.prototype, 'warn')
      .mockImplementation(() => undefined);
    (dispatcher.reconcileStalePublishedEvents as jest.Mock)
      .mockRejectedValueOnce(new Error('DB_DOWN'))
      .mockResolvedValue({ requeued: 1 });
    const runner = createRunner({
      OUTBOX_DISPATCH_ENABLED: true,
      OUTBOX_DISPATCH_INTERVAL_MS: 10,
    });

    runner.onApplicationBootstrap();
    await jest.advanceTimersByTimeAsync(120_000);
    await runner.onApplicationShutdown();

    expect(dispatcher.reconcileStalePublishedEvents).toHaveBeenCalledTimes(2);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith('outbox_reconcile_failed', {
      status: 'FAILED',
      errorCode: 'DB_DOWN',
    });
  });

  it('skips a reconcile tick while the previous run is still in flight and waits for it on shutdown', async () => {
    let finishReconcile: (value: OutboxReconcileResult) => void = () =>
      undefined;
    (dispatcher.reconcileStalePublishedEvents as jest.Mock).mockReturnValue(
      new Promise<OutboxReconcileResult>((resolve) => {
        finishReconcile = resolve;
      }),
    );
    const runner = createRunner({
      OUTBOX_DISPATCH_ENABLED: true,
      OUTBOX_DISPATCH_INTERVAL_MS: 10,
    });

    runner.onApplicationBootstrap();
    await jest.advanceTimersByTimeAsync(180_000);
    expect(dispatcher.reconcileStalePublishedEvents).toHaveBeenCalledTimes(1);

    let shutdownFinished = false;
    const shutdown = runner.onApplicationShutdown().then(() => {
      shutdownFinished = true;
    });
    await jest.advanceTimersByTimeAsync(0);
    expect(shutdownFinished).toBe(false);

    finishReconcile({ requeued: 0 });
    await shutdown;
    expect(shutdownFinished).toBe(true);
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
