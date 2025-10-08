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
  redirect?: "manual" | "follow" | "error";
  rawResponse?: boolean;
}

export type RequestWithBodyOptions = BaseRequestOptions & { body?: any; };

export type GholaRequestOptions = {
  baseUrl?: string;
  method?: HttpMethod;
  options?: RequestWithBodyOptions;
  cache?: { keyPrefix?: string };
};

export type GholaRequest = {
  endpoint: string;
  options: GholaRequestOptions;
};

export type RequestRetryFunction = (request: GholaRequest) => Promise<GholaResponse<any>>;

export type GholaMiddleware = {
  pre?: (options: GholaRequestOptions) => GholaRequestOptions | Promise<GholaRequestOptions>;
  post?: <T>(response: GholaResponse<T>) => GholaResponse<T> | Promise<GholaResponse<T>>;
  error?: <T>(error: GholaFetchError<T>, request: GholaRequest, retry: RequestRetryFunction) => void | GholaResponse<T> | Promise<GholaResponse<T>>;
};
