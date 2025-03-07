import { ICache } from './cache/types';

export type GholaOptions = {
  baseUrl?: string;
  headers?: Record<string, string>;
  cache?: ICache;
};

export type GholaResponse<T> = {
  headers: Headers;
  status: number;
  statusText: string;
  data: T;
};

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';

export type GholaRequestOptions = {
  baseUrl?: string;
  method?: HttpMethod;
  options?: {
    headers?: Record<string, string>;
    body?: any;
  };
  cache?: { keyPrefix?: string };
};

export type GholaMiddleware = {
  pre?: (options: GholaRequestOptions) => GholaRequestOptions | Promise<GholaRequestOptions>;
  post?: <T>(response: GholaResponse<T>) => GholaResponse<T> | Promise<GholaResponse<T>>;
};
