import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

import {
  StructuredLogger,
  toSafeErrorCode,
} from '../common/logging/structured-logger';
import { createHealthRedisConnectionOptions } from '../processing/redis-options';

@Injectable()
export class RedisHealthCheckService implements OnModuleDestroy {
  private readonly logger = new StructuredLogger(RedisHealthCheckService.name);
  private client: Redis | null = null;
  private connectPromise: Promise<void> | null = null;

  constructor(private readonly configService: ConfigService) {}

  async check(): Promise<void> {
    const client = this.getClient();

    try {
      await this.connect(client);
      await client.ping();
    } catch (error) {
      this.resetClient(client);
      throw error;
    }
  }

  onModuleDestroy(): void {
    const client = this.client;
    this.client = null;
    this.connectPromise = null;

    if (client) {
      client.disconnect(false);
    }
  }

  private getClient(): Redis {
    // retryStrategy disables reconnects, so a client whose connection was
    // dropped by an outage ends up in 'end' (or 'close') and can never become
    // ready again. Replace it here instead of failing the first check after
    // Redis recovers.
    if (
      this.client &&
      (this.client.status === 'end' || this.client.status === 'close')
    ) {
      this.resetClient(this.client);
    }

    if (!this.client) {
      const { url, ...options } = createHealthRedisConnectionOptions(
        this.configService.getOrThrow<string>('REDIS_URL'),
      );

      this.client = new Redis(url, options);
      this.client.on('error', (error) => {
        this.logger.warn('redis_health_check_error', {
          status: 'FAILED',
          errorCode: toSafeErrorCode(error, 'REDIS_HEALTH_CHECK_ERROR'),
        });
      });
    }

    return this.client;
  }

  private async connect(client: Redis): Promise<void> {
    if (client.status === 'ready') {
      return;
    }

    if (this.connectPromise) {
      await this.connectPromise;
      return;
    }

    if (client.status !== 'wait') {
      throw new Error('REDIS_HEALTH_CLIENT_NOT_READY');
    }

    this.connectPromise = client.connect().finally(() => {
      this.connectPromise = null;
    });

    await this.connectPromise;
  }

  private resetClient(client: Redis): void {
    if (this.client === client) {
      this.client = null;
      this.connectPromise = null;
    }

    client.disconnect(false);
  }
}
