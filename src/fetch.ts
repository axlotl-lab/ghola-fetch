import { ICache } from './cache/types';
import { GholaFetchError } from './fetch-error';
import { GholaMiddleware, GholaOptions, GholaRequestOptions, GholaResponse } from './types';

export class GholaFetch {
  protected baseUrl: string | undefined;
  protected defaultHeaders: Record<string, string> | undefined;
  private middlewares: GholaMiddleware[] = [];
  private cache?: ICache;
  private isNode: boolean;

  // Static instance for direct usage
  private static instance: GholaFetch;

  constructor(options?: GholaOptions) {
    this.baseUrl = options?.baseUrl ?? '';
    this.defaultHeaders = options?.headers;
    this.cache = options?.cache;
    this.isNode =
      typeof process !== 'undefined' && process.versions != null && process.versions.node != null;
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
  public static create(options?: GholaOptions): GholaFetch {
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
   * Makes a request to the API
   * @param endpoint The API endpoint
   * @param options The request options
   * @returns A promise that resolves to the API response
   */
  public async request<T = any>(
    endpoint: string,
    options: GholaRequestOptions = {}
  ): Promise<GholaResponse<T>> {
    const headers = { ...this.defaultHeaders, ...options.options?.headers };

    // Apply pre processing middlewares
    const processedOptions = await this.applyPreMiddlewares({
      ...options,
      options: { ...options.options, headers },
    });

    const url = `${(this.baseUrl || processedOptions.baseUrl) ?? ''}${endpoint}`;
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

    try {
      const response = await fetch(url, {
        method: processedOptions.method || 'GET',
        headers: processedOptions.options?.headers,
        body,
      });

      // Try to get the response body, even if it's not OK
      let data: T;
      try {
        data = await this.getBody<T>(response);
      } catch (bodyError) {
        console.error('Error processing response body:', bodyError);
        // If we can't process the body, use null as data
        data = null as unknown as T;
      }

      const apiResponse: GholaResponse<T> = {
        headers: response.headers,
        status: response.status,
        statusText: response.statusText,
        data,
      };

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

      // Generic error handling
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
        throw new GholaFetchError(defaultError, response.status, processedResponse);
      }

      return processedResponse;
    } catch (error) {
      // This block captures both network errors AND API errors (!response.ok)

      // If it's already an ApiClientError (from our own throw), just re-throw it
      if (error instanceof GholaFetchError) {
        throw error;
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

      throw new GholaFetchError(
        error instanceof Error ? error.message : String(error),
        0, // Status 0 for network/fetch errors
        syntheticResponse
      );
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
    options: { headers?: Record<string, string> } = {}
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
    options: { headers?: Record<string, string> } = {}
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
    options: { body?: any; headers?: Record<string, string> } = {}
  ): Promise<GholaResponse<T>> {
    return this.request<T>(endpoint, { method: 'POST', options });
  }

  /**
   * Makes a POST request to the API (static version)
   * @param endpoint The API endpoint
   * @param options The request options
   * @returns A promise that resolves to the API response
   */
  public static post<T = any>(
    endpoint: string,
    options: { body?: any; headers?: Record<string, string> } = {}
  ): Promise<GholaResponse<T>> {
    return GholaFetch.getInstance().post<T>(endpoint, options);
  }

  /**
   * Makes a PUT request to the API
   * @param endpoint The API endpoint
   * @param options The request options
   * @returns A promise that resolves to the API response
   */
  public put<T = any>(
    endpoint: string,
    options: { body?: any; headers?: Record<string, string> } = {}
  ): Promise<GholaResponse<T>> {
    return this.request<T>(endpoint, { method: 'PUT', options });
  }

  /**
   * Makes a PUT request to the API (static version)
   * @param endpoint The API endpoint
   * @param options The request options
   * @returns A promise that resolves to the API response
   */
  public static put<T = any>(
    endpoint: string,
    options: { body?: any; headers?: Record<string, string> } = {}
  ): Promise<GholaResponse<T>> {
    return GholaFetch.getInstance().put<T>(endpoint, options);
  }

  /**
   * Makes a DELETE request to the API
   * @param endpoint The API endpoint
   * @param options The request options
   * @returns A promise that resolves to the API response
   */
  public delete<T = any>(
    endpoint: string,
    options: { headers?: Record<string, string> } = {}
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
    options: { headers?: Record<string, string> } = {}
  ): Promise<GholaResponse<T>> {
    return GholaFetch.getInstance().delete<T>(endpoint, options);
  }

  /**
   * Processes the response body based on the Content-Type header
   * @param response The fetch Response object
   * @returns The processed body data
   */
  private async getBody<T>(response: Response): Promise<T> {
    const contentType = response.headers.get('Content-Type');

    try {
      if (!contentType) {
        // Handle case where there is no Content-Type header
        console.warn('No Content-Type header in response');
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
        contentType.includes('image/')
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
      throw new Error('Failed to process response body');
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
}