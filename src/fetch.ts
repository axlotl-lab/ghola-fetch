import { ICache } from './cache/types';
import { GholaFetchError } from './fetch-error';
import { BaseRequestOptions, ConstructorOptions, GholaMiddleware, GholaRequestOptions, GholaResponse } from './types';

export class GholaFetch {
  protected baseUrl: string | undefined;
  protected defaultHeaders: Record<string, string> | undefined;
  private middlewares: GholaMiddleware[] = [];
  private cache?: ICache;
  private isNode: boolean;
  private defaultTimeout?: number;

  // Static instance for direct usage
  private static instance: GholaFetch;

  constructor(options?: ConstructorOptions) {
    this.baseUrl = options?.baseUrl ?? '';
    this.defaultHeaders = options?.headers;
    this.cache = options?.cache;
    this.defaultTimeout = options?.timeout;

    this.isNode =
      typeof process !== 'undefined' && process.versions != null && process.versions.node != null;

    // Verify that the fetch API is available and that AbortController is supported
    if (typeof fetch !== 'function') {
      console.warn('GholaFetch: fetch API is not available in this environmnet. The library may not work correctly.');
    }

    if (typeof AbortController === 'undefined') {
      console.warn('GholaFetch: AbortController is not available in this environment. Timeouts may not work correctly.');
    }
  }

  /**
   * Get the singleton instance or create it if it doesn't exist
   */
  private static getInstance(): GholaFetch {
    if (!GholaFetch.instance) {
      GholaFetch.instance = new GholaFetch();
    }
    return GholaFetch.instance;
  }

  /**
   * Configure the default instance
   * @param options The options to configure the default instance
   * @returns The configured instance
   */
  public static create(options?: ConstructorOptions): GholaFetch {
    GholaFetch.instance = new GholaFetch(options);
    return GholaFetch.instance;
  }

  /**
   * Applies pre-request middlewares to the request options
   * @param options The request options
   * @returns The processed request options
   */
  private async applyPreMiddlewares(options: GholaRequestOptions): Promise<GholaRequestOptions> {
    let processedOptions = options;
    for (const middleware of this.middlewares) {
      if (middleware.pre) {
        processedOptions = await middleware.pre(processedOptions);
      }
    }
    return processedOptions;
  }

  /**
   * Applies post-response middlewares to the API response
   * @param response The API response
   * @returns The processed API response
   */
  private async applyPostMiddlewares<T>(response: GholaResponse<T>): Promise<GholaResponse<T>> {
    let processedResponse = response;
    for (const middleware of this.middlewares) {
      if (middleware.post) {
        processedResponse = await middleware.post(processedResponse);
      }
    }
    return processedResponse;
  }

  /**
   * Registers a middleware with the API client
   * @param middleware The middleware to register
   * @returns The GholaFetch instance for chaining
   */
  public use(middleware: GholaMiddleware): GholaFetch {
    this.middlewares.push(middleware);
    return this;
  }

  /**
   * Registers a middleware with the static instance
   * @param middleware The middleware to register
   * @returns The GholaFetch instance for chaining
   */
  public static use(middleware: GholaMiddleware): GholaFetch {
    return GholaFetch.getInstance().use(middleware);
  }

  /**
 * Builds URL with query parameters
 * @param baseUrl The base URL without query parameters
 * @param params The query parameters object
 * @returns URL with query parameters
 */
  private buildUrl(baseUrl: string, params?: Record<string, any>): string {
    if (!params || Object.keys(params).length === 0) {
      return baseUrl;
    }

    // Create an instance of URLSearchParams for proper encoding
    const searchParams = new URLSearchParams();

    // Add all parameters that are not undefined to the search params
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined) {
        // Handle arrays and objects by serializing them to JSON if needed
        if (Array.isArray(value) || (typeof value === 'object' && value !== null)) {
          searchParams.append(key, JSON.stringify(value));
        } else {
          searchParams.append(key, String(value));
        }
      }
    });

    const queryString = searchParams.toString();
    if (queryString) {
      // Check if the URL already has query parameters
      return baseUrl.includes('?')
        ? `${baseUrl}&${queryString}`
        : `${baseUrl}?${queryString}`;
    }

    return baseUrl;
  }

  /**
   * Makes a request to the API
   * @param endpoint The API endpoint
   * @param options The request options
   * @returns A promise that resolves to the API response
   */
  public async request<T = any>(
    endpoint: string,
    options: GholaRequestOptions = {}
  ): Promise<GholaResponse<T>> {
    const headers = Object.fromEntries(
      Object.entries({ ...this.defaultHeaders, ...options.options?.headers })
        .filter(([_, value]) => value !== null && value !== undefined)
    );
    // Apply pre processing middlewares
    const processedOptions = await this.applyPreMiddlewares({
      ...options,
      options: { ...options.options, headers },
    });

    let url = `${(this.baseUrl || processedOptions.baseUrl) ?? ''}${endpoint}`;

    // Apply query parameters if provided
    if (processedOptions.options?.params) {
      url = this.buildUrl(url, processedOptions.options.params);
    }

    const cacheKey = `${processedOptions.cache?.keyPrefix ?? ''}-${url}`;

    // Check cache for existing response
    if (this.cache) {
      const cachedResponse = this.cache.get<GholaResponse<T>>(cacheKey);
      if (cachedResponse) {
        return cachedResponse;
      }
    }

    const body = this.processBody(
      processedOptions.options?.body,
      processedOptions.options?.headers ?? {}
    );

    // Configure timeout only if AbortController is available
    let controller: AbortController | undefined;
    let signal: AbortSignal | undefined;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    const timeout = processedOptions.options?.timeout ?? this.defaultTimeout;

    // Only configure timeout if it's specified and AbortController is available
    if (typeof AbortController !== 'undefined' && timeout) {
      controller = new AbortController();
      signal = controller.signal;

      timeoutId = setTimeout(() => {
        controller?.abort();
      }, timeout);
    } else if (timeout && typeof AbortController === 'undefined') {
      console.warn('GholaFetch: Is not possible to set timeout because AbortController is not available in this environment.');
    }

    try {
      const fetchOptions: RequestInit = {
        method: processedOptions.method || 'GET',
        headers: processedOptions.options?.headers,
        body,
      };

      if (signal) {
        fetchOptions.signal = signal;
      }

      const response = await fetch(url, fetchOptions);

      if (timeoutId) {
        clearTimeout(timeoutId);
      }

      // Try to get the response body, even if it's not OK
      const data = await this.getBody<T>(response);

      const apiResponse: GholaResponse<T> = {
        headers: response.headers,
        status: response.status,
        statusText: response.statusText,
        data,
      };

      // Error handling
      if (!response.ok) {
        const defaultError = `HTTP Error: ${response.status} ${response.statusText}`;

        // Log the error
        if (typeof data == 'object') {
          console.error(defaultError, JSON.stringify(data));
        } else {
          console.error(defaultError, data);
        }

        // Throw the error with the complete response
        // Don't make any assumptions about the error data structure
        throw new GholaFetchError(defaultError, response.status, apiResponse);
      }

      // Apply post processing middlewares
      const processedResponse = await this.applyPostMiddlewares(apiResponse);

      // Cache handling (now only cache successful responses)
      if (response.ok && this.cache) {
        const cacheControl = response.headers.get('Cache-Control');
        let ttl: number | undefined;

        if (cacheControl) {
          const maxAgeMatch = cacheControl.match(/max-age=(\d+)/);
          if (maxAgeMatch) {
            ttl = parseInt(maxAgeMatch[1], 10) * 1000; // Convert to milliseconds
            this.cache.set(cacheKey, processedResponse, ttl);
          }
        }
      }

      return processedResponse;
    } catch (error: any) {
      // This block captures both network errors AND API errors (!response.ok)

      if (timeoutId) {
        clearTimeout(timeoutId);
      }

      if (error.name === 'AbortError') {
        console.error('Request timed out after', timeout, 'ms');

        // Create a synthetic response for timeout errors
        const syntheticResponse: GholaResponse<T> = {
          headers: new Headers(),
          status: 408, // Request Timeout
          statusText: 'Request Timeout',
          data: { message: `Request timed out after ${timeout}ms` } as T,
        };

        const gholaFetchError = new GholaFetchError('Request timeout', 408, syntheticResponse);
        return this.handleError(gholaFetchError);
      }

      // If it's already an ApiClientError (from our own throw), just re-throw it
      if (error instanceof GholaFetchError) {
        return this.handleError(error);
      }

      // Otherwise it's a network or unexpected error
      console.error('Fetch error:', error);

      // Create a synthetic response for network errors
      const syntheticResponse: GholaResponse<T> = {
        headers: new Headers(),
        status: 0,
        statusText: 'Network Error',
        data: { originalError: error } as T,
      };

      const gholaFetchError = new GholaFetchError(
        error instanceof Error ? error.message : String(error),
        0, // Status 0 for network/fetch errors
        syntheticResponse
      );
      return this.handleError(gholaFetchError);
    }
  }

  /**
   * Makes a request to the API (static version)
   * @param endpoint The API endpoint
   * @param options The request options
   * @returns A promise that resolves to the API response
   */
  public static request<T = any>(
    endpoint: string,
    options: GholaRequestOptions = {}
  ): Promise<GholaResponse<T>> {
    return GholaFetch.getInstance().request<T>(endpoint, options);
  }

  /**
   * Makes a GET request to the API
   * @param endpoint The API endpoint
   * @param options The request options
   * @returns A promise that resolves to the API response
   */
  public get<T = any>(
    endpoint: string,
    options: BaseRequestOptions = {}
  ): Promise<GholaResponse<T>> {
    return this.request<T>(endpoint, { method: 'GET', options });
  }

  /**
   * Makes a GET request to the API (static version)
   * @param endpoint The API endpoint
   * @param options The request options
   * @returns A promise that resolves to the API response
   */
  public static get<T = any>(
    endpoint: string,
    options: BaseRequestOptions = {}
  ): Promise<GholaResponse<T>> {
    return GholaFetch.getInstance().get<T>(endpoint, options);
  }

  /**
   * Makes a POST request to the API
   * @param endpoint The API endpoint
   * @param options The request options
   * @returns A promise that resolves to the API response
   */
  public post<T = any>(
    endpoint: string,
    body?: any,
    options: BaseRequestOptions = {}
  ): Promise<GholaResponse<T>> {
    return this.request<T>(endpoint, {
      method: 'POST',
      options: { ...options, body }
    });
  }

  /**
   * Makes a POST request to the API (static version)
   * @param endpoint The API endpoint
   * @param options The request options
   * @returns A promise that resolves to the API response
   */
  public static post<T = any>(
    endpoint: string,
    body?: any,
    options: BaseRequestOptions = {}
  ): Promise<GholaResponse<T>> {
    return GholaFetch.getInstance().post<T>(endpoint, body, options);
  }

  /**
   * Makes a PUT request to the API
   * @param endpoint The API endpoint
   * @param options The request options
   * @returns A promise that resolves to the API response
   */
  public put<T = any>(
    endpoint: string,
    body?: any,
    options: BaseRequestOptions = {}
  ): Promise<GholaResponse<T>> {
    return this.request<T>(endpoint, {
      method: 'PUT',
      options: { ...options, body }
    });
  }

  /**
   * Makes a PUT request to the API (static version)
   * @param endpoint The API endpoint
   * @param options The request options
   * @returns A promise that resolves to the API response
   */
  public static put<T = any>(
    endpoint: string,
    body?: any,
    options: BaseRequestOptions = {}
  ): Promise<GholaResponse<T>> {
    return GholaFetch.getInstance().put<T>(endpoint, body, options);
  }

  /**
 * Makes a PATCH request to the API
 * @param endpoint The API endpoint
 * @param body The request body
 * @param options The request options
 * @returns A promise that resolves to the API response
 */
  public patch<T = any>(
    endpoint: string,
    body?: any,
    options: BaseRequestOptions = {}
  ): Promise<GholaResponse<T>> {
    return this.request<T>(endpoint, {
      method: 'PATCH',
      options: { ...options, body }
    });
  }

  public static patch<T = any>(
    endpoint: string,
    body?: any,
    options: BaseRequestOptions = {}
  ): Promise<GholaResponse<T>> {
    return GholaFetch.getInstance().patch<T>(endpoint, body, options);
  }

  /**
   * Makes a DELETE request to the API
   * @param endpoint The API endpoint
   * @param options The request options
   * @returns A promise that resolves to the API response
   */
  public delete<T = any>(
    endpoint: string,
    options: BaseRequestOptions = {}
  ): Promise<GholaResponse<T>> {
    return this.request<T>(endpoint, { method: 'DELETE', options });
  }

  /**
   * Makes a DELETE request to the API (static version)
   * @param endpoint The API endpoint
   * @param options The request options
   * @returns A promise that resolves to the API response
   */
  public static delete<T = any>(
    endpoint: string,
    options: BaseRequestOptions = {}
  ): Promise<GholaResponse<T>> {
    return GholaFetch.getInstance().delete<T>(endpoint, options);
  }

  /**
   * Processes the response body based on the Content-Type header
   * @param response The fetch Response object
   * @returns The processed body data
   */
  private async getBody<T>(response: Response): Promise<T> {
    try {
      const contentType = response.headers && response.headers.get('Content-Type');

      if (!contentType) {
        // Handle case where there is no Content-Type header
        return (await response.text()) as unknown as T;
      }

      if (
        contentType.includes('application/json') ||
        contentType.includes('application/problem+json')
      ) {
        return await response.json();
      } else if (contentType.includes('text/')) {
        return (await response.text()) as unknown as T;
      } else if (contentType.includes('multipart/form-data')) {
        return (await response.formData()) as unknown as T;
      } else if (
        contentType.includes('application/octet-stream') ||
        contentType.includes('image/') ||
        contentType.includes('application/pdf') ||
        contentType.includes('application/zip') ||
        contentType.includes('application/msword') ||
        contentType.includes('application/vnd.openxmlformats')
      ) {
        return (await response.blob()) as unknown as T;
      } else if (contentType.includes('application/octet-buffer')) {
        return (await response.arrayBuffer()) as unknown as T;
      } else {
        // Handle other content types if necessary
        console.warn(`Unsupported content type: ${contentType}`);
        return (await response.text()) as unknown as T;
      }
    } catch (error) {
      console.error('Error processing response body:', error);
      // If we can't process the body, use null as data
      return null as unknown as T;
    }
  }

  /**
   * Processes the request body based on its type
   * @param body The request body
   * @param headers The request headers
   * @returns The processed body
   */
  private processBody(body: any, headers: Record<string, string>): any {
    if (body instanceof FormData) {
      if (!this.isNode) {
        // Let the browser handle the Content-Type
        delete headers['Content-Type'];
      }
      // In Node.js, FormData will set its own Content-Type with boundary
      return body;
    }

    // If the body is a File or Blob, convert it to FormData
    if (body instanceof File || body instanceof Blob) {
      const formData = new FormData();
      formData.append('file', body);
      delete headers['Content-Type'];
      return formData;
    }

    if (typeof body === 'string' || body instanceof URLSearchParams) {
      return body;
    }

    if (body !== undefined) {
      headers['Content-Type'] = headers['Content-Type'] || 'application/json';
      return JSON.stringify(body);
    }

    return undefined;
  }

  /**
   * Processes an error through error middlewares before throwing it
   * @param error The error to process
   * @throws The processed error, or a response if middleware converts it
   */
  private async handleError<T>(error: GholaFetchError<T>): Promise<GholaResponse<T>> {
    let processedError = error;

    for (const middleware of this.middlewares) {
      if (middleware.error) {
        try {
          // Middleware can either return a modified error or convert it to a response
          const result = await middleware.error(processedError);

          if (result === undefined) {
            continue;
          }

          // If middleware returns a response instead of an error, return it
          if (!(result instanceof GholaFetchError)) {
            return result as GholaResponse<T>;
          }

          // Otherwise, continue processing with the modified error
          processedError = result;
        } catch (middlewareError) {
          // Continue with other middlewares if one fails
          console.error('Error in error middleware:', middlewareError);

          // Add the error to the middlewareErrors array
          if (processedError.middlewareErrors === undefined) {
            processedError.middlewareErrors = [];
          }
          processedError.middlewareErrors.push(middlewareError);
        }
      }
    }

    // If no middleware converted the error to a response, throw the final processed error
    throw processedError;
  }
}