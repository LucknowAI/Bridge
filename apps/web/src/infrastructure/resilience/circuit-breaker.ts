/** Thrown instead of calling a provider that keeps failing. */
export class CircuitOpenError extends Error {
  constructor(name: string) {
    super(`${name} is temporarily unavailable`);
    this.name = "CircuitOpenError";
  }
}

/**
 * Stops calling a provider after `failureThreshold` consecutive failures, for
 * `resetAfterMs`. Then one trial call is let through: success closes the
 * circuit, failure opens it again. Keeps an outage from adding a timeout to
 * every request.
 */
export class CircuitBreaker {
  private failures = 0;
  private openedAt: number | null = null;
  private trialRunning = false;

  constructor(
    private readonly name: string,
    private readonly options: { failureThreshold: number; resetAfterMs: number } = { failureThreshold: 5, resetAfterMs: 30_000 },
    private readonly now: () => number = Date.now
  ) {}

  get state(): "closed" | "open" | "half-open" {
    if (this.openedAt === null) return "closed";
    return this.now() - this.openedAt >= this.options.resetAfterMs ? "half-open" : "open";
  }

  async execute<T>(call: () => Promise<T>): Promise<T> {
    const state = this.state;
    if (state === "open" || (state === "half-open" && this.trialRunning)) throw new CircuitOpenError(this.name);
    if (state === "half-open") this.trialRunning = true;
    try {
      const result = await call();
      this.failures = 0;
      this.openedAt = null;
      return result;
    } catch (error) {
      this.failures += 1;
      if (state === "half-open" || this.failures >= this.options.failureThreshold) this.openedAt = this.now();
      throw error;
    } finally {
      if (state === "half-open") this.trialRunning = false;
    }
  }
}
