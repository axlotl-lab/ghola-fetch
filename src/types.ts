import { ICache } from './cache/types';
import { GholaFetchError } from './fetch-error';

export type ConstructorOptions = {
  baseUrl?: string;
  headers?: Headers;
  cache?: ICache;
  timeout?: number;
};

export type GholaResponse<T> = {
  headers: Headers;
  status: number;
  statusText: string;
  redirected?: boolean;
  url?: string;
  data: T;
  raw?: Response;
};

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';

export type BaseRequestOptions = {
  headers?: Headers;
  timeout?: number;
  params?: URLSearchParams | Record<string, any>;
  signal?: AbortSignal;
  redirect?: 'manual' | 'follow' | 'error';
  rawResponse?: boolean;
};

export type RequestWithBodyOptions = BaseRequestOptions & { body?: any };

export type GholaRequestOptions = {
  baseUrl?: string;
  method?: HttpMethod;
  options?: RequestWithBodyOptions;
  cache?: { keyPrefix?: string };
  retry?: { attempt?: number };
};

export type GholaRequest = {
  endpoint: string;
  options: GholaRequestOptions;
};

export type RequestRetryFunction = (request: GholaRequest) => Promise<GholaResponse<any>>;

/**
 * Per-attempt context, shared by every middleware hook of the same attempt.
 * Each attempt (the original request and every retry) gets its own new object.
 */
export type GholaRequestContext = {
  /** The endpoint as passed to request(), without baseUrl or `params` */
  endpoint: string;
  /** The HTTP method. Updated after the `pre` middlewares in case one of them changed it */
  method: HttpMethod;
  /** Date.now() when the attempt started, before the `pre` middlewares run */
  startTime: number;
  /** 1 for the original request, +1 for each retry */
  attempt: number;
  /** true when the response was served from the internal cache */
  fromCache: boolean;
  /** Free space for middlewares to store data across the hooks of this attempt */
  state: Record<string, unknown>;
};

/** How an attempt ended: either a response or an error, never both */
export type GholaSettledOutcome<T = any> =
  | { response: GholaResponse<T>; error?: undefined }
  | { error: GholaFetchError<T>; response?: undefined };

export type GholaMiddleware = {
  pre?: (
    options: GholaRequestOptions,
    context: GholaRequestContext
  ) => GholaRequestOptions | Promise<GholaRequestOptions>;
  post?: <T>(
    response: GholaResponse<T>,
    context: GholaRequestContext
  ) => GholaResponse<T> | Promise<GholaResponse<T>>;
  error?: <T>(
    error: GholaFetchError<T>,
    request: GholaRequest,
    retry: RequestRetryFunction,
    context: GholaRequestContext
  ) => void | GholaResponse<T> | Promise<GholaResponse<T>>;
  /**
   * Observation-only hook, called exactly once per attempt when it ends: on success, on any
   * error (before the `error` middlewares run) and on cache hits. It can't change the outcome,
   * it isn't awaited, and anything it throws (or rejects with) is logged and ignored.
   */
  settled?: (outcome: GholaSettledOutcome, context: GholaRequestContext) => void | Promise<void>;
};
