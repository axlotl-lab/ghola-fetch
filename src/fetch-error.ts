import { GholaResponse } from './types';

/**
 * What caused a GholaFetchError:
 * - `http`: the server answered with a non-2xx status (>= 400)
 * - `timeout`: the request exceeded the configured `timeout`
 * - `aborted`: the request was cancelled through the `signal` option
 * - `network`: `fetch` itself failed (DNS, connection refused, CORS, offline...)
 * - `unknown`: anything else (an error thrown by a middleware, a body that can't be serialized...)
 */
export type GholaFetchErrorKind = 'http' | 'timeout' | 'aborted' | 'network' | 'unknown';

export class GholaFetchError<T> extends Error {
  status: number;
  response?: GholaResponse<T>;
  kind: GholaFetchErrorKind;

  /**
   * @param kind Defaults to `http` when `status >= 400`, `unknown` otherwise
   */
  constructor(
    message: string,
    status: number,
    response?: GholaResponse<T>,
    kind?: GholaFetchErrorKind
  ) {
    super(message);
    this.name = 'GholaFetchError';
    this.status = status;
    this.response = response;
    this.kind = kind ?? (status >= 400 ? 'http' : 'unknown');
  }
}
