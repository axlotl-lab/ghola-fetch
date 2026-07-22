import { RetryStrategy } from './types';

export class FixedDelay implements RetryStrategy {
  constructor(private delayMs: number) {}

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  getDelay(attempt: number): number {
    return this.delayMs;
  }
}

export class ExponentialBackoff implements RetryStrategy {
  constructor(
    private baseMs: number = 200,
    private factor: number = 2,
    private maxMs: number = 30_000
  ) {}

  getDelay(attempt: number): number {
    return Math.min(this.baseMs * this.factor ** (attempt - 1), this.maxMs);
  }
}

export class ExponentialBackoffWithJitter implements RetryStrategy {
  constructor(
    private baseMs: number = 200,
    private factor: number = 2,
    private maxMs: number = 30_000
  ) {}

  getDelay(attempt: number): number {
    const cap = Math.min(this.baseMs * this.factor ** (attempt - 1), this.maxMs);
    return Math.random() * cap;
  }
}
