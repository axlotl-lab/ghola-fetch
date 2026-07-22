import { GholaFetchError } from '../fetch-error';
import { GholaMiddleware, GholaRequest, GholaResponse, HttpMethod, RequestRetryFunction } from '../types';
import { ExponentialBackoffWithJitter } from './strategies';
import {
  ResolvedVerbRetryOptions,
  RetryCondition,
  RetryMiddlewareOptions,
  RetryStrategy,
  VerbRetryOptions,
} from './types';

const ALL_METHODS: HttpMethod[] = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'];
const IDEMPOTENT_METHODS: HttpMethod[] = ['GET', 'PUT', 'DELETE', 'PATCH'];

function resolveCondition(
  override: RetryCondition | undefined,
  fallback: Required<RetryCondition>
): Required<RetryCondition> {
  return {
    statusCodes: override?.statusCodes ?? fallback.statusCodes,
    onNetworkError: override?.onNetworkError ?? fallback.onNetworkError,
  };
}

function buildMethodConfig(
  methods: Partial<Record<HttpMethod, boolean | VerbRetryOptions>> | undefined,
  defaults: {
    maxRetries: number;
    strategy: RetryStrategy;
    condition: Required<RetryCondition>;
  }
): Record<HttpMethod, ResolvedVerbRetryOptions> {
  const config = {} as Record<HttpMethod, ResolvedVerbRetryOptions>;

  for (const method of ALL_METHODS) {
    const override = methods?.[method];
    const defaultEnabled = IDEMPOTENT_METHODS.includes(method);

    if (override === undefined) {
      config[method] = {
        enabled: defaultEnabled,
        maxRetries: defaults.maxRetries,
        strategy: defaults.strategy,
        condition: defaults.condition,
      };
    } else if (typeof override === 'boolean') {
      config[method] = {
        enabled: override,
        maxRetries: defaults.maxRetries,
        strategy: defaults.strategy,
        condition: defaults.condition,
      };
    } else {
      config[method] = {
        enabled: override.enabled ?? defaultEnabled,
        maxRetries: override.maxRetries ?? defaults.maxRetries,
        strategy: override.strategy ?? defaults.strategy,
        condition: resolveCondition(override.condition, defaults.condition),
      };
    }
  }

  return config;
}

/**
 * Parses the Retry-After header (either delay-seconds or an HTTP-date) into a millisecond delay.
 * @returns The delay in ms, or null if the header is absent/unparseable/in the past
 */
function parseRetryAfter(value: string | null): number | null {
  if (!value) {
    return null;
  }

  if (/^\d+$/.test(value.trim())) {
    return parseInt(value, 10) * 1000;
  }

  const dateMs = Date.parse(value);
  if (Number.isNaN(dateMs)) {
    return null;
  }

  const delay = dateMs - Date.now();
  return delay > 0 ? delay : 0;
}

function sleep(ms: number): Promise<void> {
  if (ms <= 0) {
    return Promise.resolve();
  }
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function RetryMiddleware(options: RetryMiddlewareOptions = {}): GholaMiddleware {
  const defaultMaxRetries = options.maxRetries ?? 3;
  const defaultStrategy = options.strategy ?? new ExponentialBackoffWithJitter();
  const defaultCondition: Required<RetryCondition> = {
    statusCodes: options.condition?.statusCodes ?? [502, 503, 504, 429],
    onNetworkError: options.condition?.onNetworkError ?? true,
  };
  const respectRetryAfter = options.respectRetryAfter ?? true;

  const methodConfig = buildMethodConfig(options.methods, {
    maxRetries: defaultMaxRetries,
    strategy: defaultStrategy,
    condition: defaultCondition,
  });

  // GholaMiddleware['error'] types as `void | GholaResponse<T> | Promise<GholaResponse<T>>`,
  // which doesn't cleanly express an async handler that resolves to `undefined` to signal
  // "not handled" (the pattern fetch.ts itself relies on via `result === undefined`).
  const errorHandler = async <T>(
    error: GholaFetchError<T>,
    request: GholaRequest,
    retry: RequestRetryFunction
  ): Promise<GholaResponse<T> | undefined> => {
    const method = (request.options.method ?? 'GET') as HttpMethod;
    const verbConfig = methodConfig[method];

    if (!verbConfig?.enabled) {
      return undefined;
    }

    const isNetworkError = error.status === 0 || error.status === 408;
    const matchesCondition =
      (verbConfig.condition.onNetworkError && isNetworkError) ||
      (!isNetworkError && verbConfig.condition.statusCodes.includes(error.status));

    if (!matchesCondition) {
      return undefined;
    }

    const attemptsMade = request.options.retry?.attempt ?? 0;
    if (attemptsMade >= verbConfig.maxRetries) {
      return undefined;
    }

    const nextAttempt = attemptsMade + 1;
    let delay = verbConfig.strategy.getDelay(nextAttempt);

    if (respectRetryAfter) {
      const retryAfter = parseRetryAfter(error.response?.headers.get('Retry-After') ?? null);
      if (retryAfter !== null) {
        delay = retryAfter;
      }
    }

    options.onRetry?.({ attempt: nextAttempt, delay, error, request });

    await sleep(delay);

    return retry({
      endpoint: request.endpoint,
      options: { ...request.options, retry: { attempt: nextAttempt } },
    });
  };

  return { error: errorHandler } as GholaMiddleware;
}
