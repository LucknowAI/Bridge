/** Thrown when a provider already has as many calls running and waiting as allowed. */
export class BulkheadFullError extends Error {
  constructor(name: string) {
    super(`${name} is busy`);
    this.name = "BulkheadFullError";
  }
}

/**
 * Limits concurrent calls to one provider in this process. Extra calls wait
 * in a bounded queue for at most `queueTimeoutMs`, so a slow provider cannot
 * tie up every request or exceed its rate limits.
 */
export class Bulkhead {
  private running = 0;
  private readonly waiting: Array<() => void> = [];

  constructor(
    private readonly name: string,
    private readonly options: { maxConcurrent: number; maxQueue: number; queueTimeoutMs: number } = { maxConcurrent: 8, maxQueue: 32, queueTimeoutMs: 2_000 }
  ) {}

  async run<T>(call: () => Promise<T>): Promise<T> {
    if (this.running >= this.options.maxConcurrent) await this.wait();
    this.running += 1;
    try {
      return await call();
    } finally {
      this.running -= 1;
      this.waiting.shift()?.();
    }
  }

  private wait(): Promise<void> {
    if (this.waiting.length >= this.options.maxQueue) return Promise.reject(new BulkheadFullError(this.name));
    return new Promise((resolve, reject) => {
      const turn = () => {
        clearTimeout(timer);
        resolve();
      };
      const timer = setTimeout(() => {
        const index = this.waiting.indexOf(turn);
        if (index >= 0) this.waiting.splice(index, 1);
        reject(new BulkheadFullError(this.name));
      }, this.options.queueTimeoutMs);
      this.waiting.push(turn);
    });
  }
}
