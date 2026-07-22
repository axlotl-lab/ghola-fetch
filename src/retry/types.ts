import { GholaFetchError } from '../fetch-error';
import { GholaRequest, HttpMethod } from '../types';

export interface RetryStrategy {
  /**
   * Computes the delay (in ms) before a retry attempt
   * @param attempt The 1-based number of the retry attempt about to be made
   */
  getDelay(attempt: number): number;
}

export type RetryCondition = {
  /** HTTP status codes that should trigger a retry. Default: [502, 503, 504, 429] */
  statusCodes?: number[];
  /** Whether network/timeout errors (no response received) should trigger a retry. Default: true */
  onNetworkError?: boolean;
};

export type VerbRetryOptions = {
  enabled?: boolean;
  maxRetries?: number;
  condition?: RetryCondition;
  strategy?: RetryStrategy;
};

export type RetryEventInfo = {
  attempt: number;
  delay: number;
  error: GholaFetchError<any>;
  request: GholaRequest;
};

export type RetryMiddlewareOptions = {
  /** Default: 3 */
  maxRetries?: number;
  /** Default: ExponentialBackoffWithJitter */
  strategy?: RetryStrategy;
  condition?: RetryCondition;
  /**
   * Per-verb overrides. GET/PUT/DELETE/PATCH are enabled by default (inheriting the
   * global maxRetries/strategy/condition). POST is disabled by default and requires
   * explicit opt-in.
   */
  methods?: Partial<Record<HttpMethod, boolean | VerbRetryOptions>>;
  /** Prefer the response's Retry-After header over the strategy's delay when present. Default: true */
  respectRetryAfter?: boolean;
  onRetry?: (info: RetryEventInfo) => void;
};

export type ResolvedVerbRetryOptions = {
  enabled: boolean;
  maxRetries: number;
  condition: Required<RetryCondition>;
  strategy: RetryStrategy;
};
