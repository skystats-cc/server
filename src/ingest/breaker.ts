import { UnavailableError } from '../lib/errors.js';

/**
 * Circuit breaker for an upstream. After `threshold` consecutive failures it opens for
 * `coolDownMs` and fails fast, so an outage at Hypixel or Mojang doesn't pile up retries.
 */
export class CircuitBreaker {
  private failures = 0;
  private openUntil = 0;

  constructor(
    readonly name: string,
    private readonly threshold = 5,
    private readonly coolDownMs = 60_000,
    private readonly now = () => Date.now(),
  ) {}

  get isOpen() {
    return this.now() < this.openUntil;
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.isOpen) throw new CircuitOpenError(this.name);
    try {
      const result = await fn();
      this.failures = 0;
      return result;
    } catch (err) {
      // 4xx (bad request, unknown player) is our problem, not an outage
      const status = (err as { upstreamStatus?: number }).upstreamStatus;
      if (status === undefined || status >= 500 || status === 429) {
        if (++this.failures >= this.threshold) {
          this.openUntil = this.now() + this.coolDownMs;
          this.failures = 0;
        }
      }
      throw err;
    }
  }
}

export class CircuitOpenError extends UnavailableError {
  constructor(name: string) {
    super(`${name} is temporarily unavailable`);
  }
}
