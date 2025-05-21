import { ICache } from './cache/types';
import { GholaFetchError } from './fetch-error';

export type GholaOptions = {
  baseUrl?: string;
  headers?: Record<string, string>;
  cache?: ICache;
  timeout?: number;
};

export type GholaResponse<T> = {
  headers: Headers;
  status: number;
  statusText: string;
  data: T;
};

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';

export type RequestOptions = {
  headers?: Record<string, string>;
  timeout?: number;
  body?: any;
}

export type RequestGetOptions = Omit<RequestOptions, 'body'>;
export type RequestDeleteOptions = Omit<RequestOptions, 'body'>;

export type GholaRequestOptions = {
  baseUrl?: string;
  method?: HttpMethod;
  options?: RequestOptions;
  cache?: { keyPrefix?: string };
};

export type GholaMiddleware = {
  pre?: (options: GholaRequestOptions) => GholaRequestOptions | Promise<GholaRequestOptions>;
  post?: <T>(response: GholaResponse<T>) => GholaResponse<T> | Promise<GholaResponse<T>>;
  error?: <T>(error: GholaFetchError<T>) => GholaResponse<T> | Promise<GholaResponse<T>> | GholaFetchError<T> | Promise<GholaFetchError<T>>;
};
