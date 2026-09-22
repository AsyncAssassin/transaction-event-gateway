export type LogThrottleDecision = {
  /** Repeats of the same key swallowed since the previous emission. */
  suppressedCount: number;
};

/**
 * Collapses bursts of identical warnings (for example one Redis reconnect
 * failure per second during an outage) into one emission per key per
 * interval. The first occurrence of a key is always emitted; later occurrences
 * are counted and surfaced as `suppressedCount` on the next emission or reset.
 */
export class LogThrottle {
  private readonly lastEmittedAt = new Map<string, number>();
  private readonly suppressedCounts = new Map<string, number>();

  constructor(
    private readonly intervalMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  shouldEmit(key: string): LogThrottleDecision | null {
    const timestamp = this.now();
    const lastEmittedAt = this.lastEmittedAt.get(key);

    if (
      lastEmittedAt !== undefined &&
      timestamp - lastEmittedAt < this.intervalMs
    ) {
      this.suppressedCounts.set(key, (this.suppressedCounts.get(key) ?? 0) + 1);
      return null;
    }

    const suppressedCount = this.suppressedCounts.get(key) ?? 0;
    this.lastEmittedAt.set(key, timestamp);
    this.suppressedCounts.set(key, 0);

    return { suppressedCount };
  }

  /** Forgets every key and returns how many repeats were suppressed in total. */
  reset(): number {
    let total = 0;

    for (const count of this.suppressedCounts.values()) {
      total += count;
    }

    this.lastEmittedAt.clear();
    this.suppressedCounts.clear();

    return total;
  }
}
