import { GholaResponse } from './types';

export class GholaFetchError<T> extends Error {
  status: number;
  response?: GholaResponse<T>;
  middlewareErrors: Error[] | any | undefined;

  constructor(message: string, status: number, response?: GholaResponse<T>) {
    super(message);
    this.name = 'GholaFetchError';
    this.status = status;
    this.response = response;
  }
}
