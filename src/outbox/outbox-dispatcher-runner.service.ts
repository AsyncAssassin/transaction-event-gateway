import {
  Injectable,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { describeError } from '../common/errors/describe-error';
import {
  StructuredLogger,
  toSafeErrorCode,
} from '../common/logging/structured-logger';
import { OutboxDispatcherService } from './outbox-dispatcher.service';

const DEFAULT_OUTBOX_DISPATCH_INTERVAL_MS = 1_000;
const RUNNER_BACKOFF_BASE_MS = 1_000;
const RUNNER_BACKOFF_MAX_MS = 30_000;
const OUTBOX_RECONCILE_INTERVAL_MS = 60_000;

@Injectable()
export class OutboxDispatcherRunnerService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new StructuredLogger(
    OutboxDispatcherRunnerService.name,
  );
  private timer: ReturnType<typeof setInterval> | null = null;
  private reconcileTimer: ReturnType<typeof setInterval> | null = null;
  private inFlightDispatch: Promise<void> | null = null;
  private inFlightReconcile: Promise<void> | null = null;
  private consecutiveFailures = 0;
  private cooldownUntilMs = 0;

  constructor(
    private readonly configService: ConfigService,
    private readonly dispatcher: OutboxDispatcherService,
  ) {}

  onApplicationBootstrap(): void {
    if (!this.isEnabled()) {
      return;
    }

    const intervalMs = this.getIntervalMs();
    this.timer = setInterval(() => this.dispatchOnce(), intervalMs);
    this.timer.unref?.();
    this.reconcileTimer = setInterval(
      () => this.reconcileOnce(),
      OUTBOX_RECONCILE_INTERVAL_MS,
    );
    this.reconcileTimer.unref?.();
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }

    if (this.reconcileTimer) {
      clearInterval(this.reconcileTimer);
      this.reconcileTimer = null;
    }

    await Promise.all([this.inFlightDispatch, this.inFlightReconcile]);
  }

  private dispatchOnce(): void {
    if (this.inFlightDispatch) {
      return;
    }

    // Back off after repeated failures (for example a prolonged database
    // outage) so the runner does not log once per tick until recovery.
    if (Date.now() < this.cooldownUntilMs) {
      return;
    }

    this.inFlightDispatch = this.dispatcher
      .dispatchBatch()
      .then(() => {
        this.consecutiveFailures = 0;
        this.cooldownUntilMs = 0;
      })
      .catch((error: unknown) => {
        this.consecutiveFailures += 1;
        this.cooldownUntilMs = Date.now() + this.calculateCooldownMs();
        this.logger.warn('outbox_dispatch_runner_failed', {
          status: 'FAILED',
          errorCode: toSafeErrorCode(error, 'OUTBOX_DISPATCH_RUNNER_FAILED'),
          ...describeError(error),
        });
      })
      .finally(() => {
        this.inFlightDispatch = null;
      });
  }

  private reconcileOnce(): void {
    if (this.inFlightReconcile) {
      return;
    }

    this.inFlightReconcile = this.dispatcher
      .reconcileStalePublishedEvents()
      .then(() => undefined)
      .catch((error: unknown) => {
        this.logger.warn('outbox_reconcile_failed', {
          status: 'FAILED',
          errorCode: toSafeErrorCode(error, 'OUTBOX_RECONCILE_FAILED'),
          ...describeError(error),
        });
      })
      .finally(() => {
        this.inFlightReconcile = null;
      });
  }

  private calculateCooldownMs(): number {
    return Math.min(
      RUNNER_BACKOFF_BASE_MS * 2 ** Math.max(0, this.consecutiveFailures - 1),
      RUNNER_BACKOFF_MAX_MS,
    );
  }

  private isEnabled(): boolean {
    const value = this.configService.get<boolean | string>(
      'OUTBOX_DISPATCH_ENABLED',
    );

    if (typeof value === 'boolean') {
      return value;
    }

    if (typeof value === 'string') {
      return value.toLowerCase() === 'true';
    }

    return true;
  }

  private getIntervalMs(): number {
    const value = this.configService.get<number | string>(
      'OUTBOX_DISPATCH_INTERVAL_MS',
    );
    const parsedValue =
      typeof value === 'number' ? value : Number(value ?? undefined);

    return Number.isInteger(parsedValue) && parsedValue > 0
      ? parsedValue
      : DEFAULT_OUTBOX_DISPATCH_INTERVAL_MS;
  }
}
