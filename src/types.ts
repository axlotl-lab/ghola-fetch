import { ICache } from './cache/types';
import { GholaFetchError } from './fetch-error';

export type ConstructorOptions = {
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

export type BaseRequestOptions = {
  headers?: Record<string, string>;
  timeout?: number;
  params?: Record<string, any>;
}

export type RequestWithBodyOptions = BaseRequestOptions & { body?: any; };

export type GholaRequestOptions = {
  baseUrl?: string;
  method?: HttpMethod;
  options?: RequestWithBodyOptions;
  cache?: { keyPrefix?: string };
};

export type GholaMiddleware = {
  pre?: (options: GholaRequestOptions) => GholaRequestOptions | Promise<GholaRequestOptions>;
  post?: <T>(response: GholaResponse<T>) => GholaResponse<T> | Promise<GholaResponse<T>>;
  error?: <T>(error: GholaFetchError<T>) => void | GholaResponse<T> | Promise<GholaResponse<T>> | GholaFetchError<T> | Promise<GholaFetchError<T>>;
};
