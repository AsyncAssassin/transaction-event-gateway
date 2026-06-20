import {
  Injectable,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import {
  StructuredLogger,
  toSafeErrorCode,
} from '../common/logging/structured-logger';
import { OutboxDispatcherService } from './outbox-dispatcher.service';

const DEFAULT_OUTBOX_DISPATCH_INTERVAL_MS = 1_000;

@Injectable()
export class OutboxDispatcherRunnerService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new StructuredLogger(
    OutboxDispatcherRunnerService.name,
  );
  private timer: ReturnType<typeof setInterval> | null = null;
  private inFlightDispatch: Promise<void> | null = null;

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
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }

    await this.inFlightDispatch;
  }

  private dispatchOnce(): void {
    if (this.inFlightDispatch) {
      return;
    }

    this.inFlightDispatch = this.dispatcher
      .dispatchBatch()
      .then(() => undefined)
      .catch((error: unknown) => {
        this.logger.warn('outbox_dispatch_runner_failed', {
          status: 'FAILED',
          errorCode: toSafeErrorCode(error, 'OUTBOX_DISPATCH_RUNNER_FAILED'),
        });
      })
      .finally(() => {
        this.inFlightDispatch = null;
      });
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
