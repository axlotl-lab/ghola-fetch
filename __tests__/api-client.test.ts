import { InMemoryCache } from '../src/cache/in-memory-cache';
import { GholaFetch } from '../src/fetch';
import { GholaFetchError } from '../src/fetch-error';
import { GholaMiddleware, GholaRequestOptions, GholaResponse } from '../src/types';

// Mock global fetch function
const mockFetch = jest.fn();
global.fetch = mockFetch as jest.Mock;

describe('GholaFetch', () => {
  let gholaFetch: GholaFetch;

  beforeEach(() => {
    // Reset static instance for each test
    GholaFetch.create({ baseUrl: 'https://api.example.com' });
    gholaFetch = new GholaFetch({ baseUrl: 'https://api.example.com' });
    mockFetch.mockReset();
  });

  describe('Instance methods', () => {
    test('should make a successful GET request with JSON response', async () => {
      const responseData = { data: 'test' };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => responseData,
        text: async () => JSON.stringify(responseData),
        headers: new Headers({ 'Content-Type': 'application/json' }),
      });

      const response = await gholaFetch.get('/test-endpoint');

      expect(response.status).toBe(200);
      expect(response.data).toEqual(responseData);
      expect(mockFetch).toHaveBeenCalledWith('https://api.example.com/test-endpoint', expect.any(Object));
    });

    test('should make a successful GET request with text response', async () => {
      const responseText = 'This is a text response';
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        text: async () => responseText,
        headers: new Headers({ 'Content-Type': 'text/plain' }),
      });

      const response = await gholaFetch.get('/test-endpoint');

      expect(response.status).toBe(200);
      expect(response.data).toEqual(responseText);
      expect(mockFetch).toHaveBeenCalledWith('https://api.example.com/test-endpoint', expect.any(Object));
    });

    test('should make a successful GET request with FormData response', async () => {
      const formData = new FormData();
      formData.append('key', 'value');
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        formData: async () => formData,
        headers: new Headers({ 'Content-Type': 'multipart/form-data' }),
      });

      const response = await gholaFetch.get('/test-endpoint');

      expect(response.status).toBe(200);
      expect(response.data).toEqual(formData);
      expect(mockFetch).toHaveBeenCalledWith('https://api.example.com/test-endpoint', expect.any(Object));
    });

    test('should make a successful GET request with Blob response', async () => {
      const blobData = new Blob(['test blob data'], { type: 'application/octet-stream' });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        blob: async () => blobData,
        headers: new Headers({ 'Content-Type': 'application/octet-stream' }),
      });

      const response = await gholaFetch.get('/test-endpoint');

      expect(response.status).toBe(200);
      expect(response.data).toEqual(blobData);
      expect(mockFetch).toHaveBeenCalledWith('https://api.example.com/test-endpoint', expect.any(Object));
    });

    test('should make a successful GET request with ArrayBuffer response', async () => {
      const buffer = new ArrayBuffer(8);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        arrayBuffer: async () => buffer,
        headers: new Headers({ 'Content-Type': 'application/octet-buffer' }),
      });

      const response = await gholaFetch.get('/test-endpoint');

      expect(response.status).toBe(200);
      expect(response.data).toEqual(buffer);
      expect(mockFetch).toHaveBeenCalledWith('https://api.example.com/test-endpoint', expect.any(Object));
    });

    test('should throw an error on a failed GET request', async () => {
      const errorData = { message: 'Not Found' };
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        json: async () => errorData,
        text: async () => JSON.stringify(errorData),
        headers: new Headers({ 'Content-Type': 'application/json' }),
      });

      await expect(gholaFetch.get('/test-endpoint')).rejects.toThrow(GholaFetchError);
      expect(mockFetch).toHaveBeenCalledWith('https://api.example.com/test-endpoint', expect.any(Object));
    });

    test('should apply pre and post middlewares', async () => {
      const preMiddleware = jest.fn(async (options) => ({
        ...options,
        options: { ...options.options, headers: { 'X-Pre-Middleware': 'true' } },
      }));
      const postMiddleware = jest.fn(async (response) => ({
        ...response,
        data: { ...response.data, modified: true },
      }));

      gholaFetch.use({ pre: preMiddleware, post: postMiddleware });

      const responseData = { data: 'test' };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => responseData,
        text: async () => JSON.stringify(responseData),
        headers: new Headers({ 'Content-Type': 'application/json' }),
      });

      const response = await gholaFetch.get('/test-endpoint');

      expect(preMiddleware).toHaveBeenCalled();
      expect(postMiddleware).toHaveBeenCalled();
      expect(response.data).toEqual({ ...responseData, modified: true });
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.example.com/test-endpoint',
        expect.objectContaining({
          headers: { 'X-Pre-Middleware': 'true' },
        })
      );
    });

    test('should not apply post middlewares if an error is thrown', async () => {
      const postMiddleware = jest.fn(async (response) => ({
        ...response,
        data: { ...response.data },
      }));

      gholaFetch.use({ post: postMiddleware });

      const responseData = { data: 'test' };
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        json: async () => responseData,
        text: async () => JSON.stringify(responseData),
        headers: new Headers({ 'Content-Type': 'application/json' }),
      });

      try {
        await gholaFetch.get('/test-endpoint');
        fail('Expected error to be thrown');
      } catch (error: any) {
        expect(error).toBeInstanceOf(GholaFetchError);
        expect(error.status).toBe(500);
        expect(error.response.data).toEqual(responseData);
        expect(postMiddleware).not.toHaveBeenCalled();
      }
    });

    test('should apply error middlewares if an error is thrown (and not converted to a response if is rethrown)', async () => {
      const errorMiddleware = jest.fn(() => {
        throw new Error('NEW_ERROR');
      });

      gholaFetch.use({ error: errorMiddleware });

      const responseData = { data: 'test' };
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        json: async () => responseData,
        text: async () => JSON.stringify(responseData),
        headers: new Headers({ 'Content-Type': 'application/json' }),
      });

      try {
        await gholaFetch.get('/test-endpoint');
        fail('Expected error to be thrown');
      } catch (error: any) {
        expect(error).toBeInstanceOf(Error);
        expect(error.message).toBe('NEW_ERROR');
        expect(errorMiddleware).toHaveBeenCalled();
      }
    });

    test('should apply error middlewares if an error is thrown (and converted to a response)', async () => {
      const errorMiddleware = jest.fn(async (error: GholaFetchError<any>) => ({
        ...error.response,
        data: { modified: true },
      } as GholaResponse<any>));

      gholaFetch.use({ error: errorMiddleware });

      const responseData = { data: 'test' };
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        json: async () => responseData,
        text: async () => JSON.stringify(responseData),
        headers: new Headers({ 'Content-Type': 'application/json' }),
      });

      try {
        const response = await gholaFetch.get('/test-endpoint');
        expect(errorMiddleware).toHaveBeenCalled();
        expect(response.data).toEqual({ modified: true });
      } catch (error: any) {
        fail('Not expecting error to be thrown');
      }
    });

    test('should support method chaining for use() method', async () => {
      const middleware1 = { pre: jest.fn(async (options) => options) };
      const middleware2 = { pre: jest.fn(async (options) => options) };

      gholaFetch.use(middleware1).use(middleware2);

      const responseData = { data: 'test' };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => responseData,
        headers: new Headers({ 'Content-Type': 'application/json' }),
      });

      await gholaFetch.get('/test-endpoint');

      expect(middleware1.pre).toHaveBeenCalled();
      expect(middleware2.pre).toHaveBeenCalled();
    });

    test('should use baseUrl from request options', async () => {
      const localApiClient = new GholaFetch();

      const preMiddleware = jest.fn(async (options: GholaRequestOptions) => ({
        ...options,
        baseUrl: 'https://from-pre-middleware.com',
        options: { ...options.options, headers: { 'X-Pre-Middleware': 'true' } },
      }));

      localApiClient.use({ pre: preMiddleware });

      const responseData = { data: 'test' };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => responseData,
        text: async () => JSON.stringify(responseData),
        headers: new Headers({ 'Content-Type': 'application/json' }),
      });

      const response = await localApiClient.get('/test-endpoint');

      expect(preMiddleware).toHaveBeenCalled();
      expect(response.data).toEqual({ ...responseData });
      expect(mockFetch).toHaveBeenCalledWith('https://from-pre-middleware.com/test-endpoint', expect.any(Object));
    });

    test('should throw a timeout error when request exceeds timeout limit', async () => {
      const mockAbort = jest.fn();
      const mockController = {
        signal: {
          addEventListener: jest.fn(),
          removeEventListener: jest.fn(),
          dispatchEvent: jest.fn(),
        },
        abort: mockAbort,
      };

      // Store original AbortController
      const OriginalAbortController = global.AbortController;

      // Mock AbortController constructor
      global.AbortController = jest.fn(() => mockController) as any;

      // Mock fetch to properly handle the abort scenario
      mockFetch.mockImplementationOnce(() => {
        // Create an abort error like the browser would
        const error = new Error('The operation was aborted');
        error.name = 'AbortError';
        return Promise.reject(error);
      });

      const timeoutClient = new GholaFetch({
        baseUrl: 'https://api.example.com',
        timeout: 1000 // 1 second timeout
      });

      // Use jest.spyOn to replace setTimeout with an immediate callback
      jest.spyOn(global, 'setTimeout').mockImplementationOnce((callback) => {
        callback();
        return 123 as any; // Return a timeout ID
      });

      const clearTimeoutSpy = jest.spyOn(global, 'clearTimeout');

      try {
        await timeoutClient.get('/test-endpoint');
        fail('Expected request to timeout, but it succeeded');
      } catch (error: any) {
        expect(error).toBeInstanceOf(GholaFetchError);

        expect(error.message).toBe('Request timeout');
        expect(error.status).toBe(408);

        expect(error.response.data.message).toMatch(/timed out after 1000ms/);
      }

      expect(mockAbort).toHaveBeenCalled();

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.example.com/test-endpoint',
        expect.objectContaining({
          signal: mockController.signal
        })
      );

      // Ensure clearTimeout was called (cleanup)
      expect(clearTimeoutSpy).toHaveBeenCalled();

      // Restore original implementations
      global.AbortController = OriginalAbortController;
      jest.restoreAllMocks();
    });
  });

  describe('Static methods', () => {
    test('should make a successful static GET request with JSON response', async () => {
      const responseData = { data: 'test' };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => responseData,
        text: async () => JSON.stringify(responseData),
        headers: new Headers({ 'Content-Type': 'application/json' }),
      });

      const response = await GholaFetch.get('/test-endpoint');

      expect(response.status).toBe(200);
      expect(response.data).toEqual(responseData);
      expect(mockFetch).toHaveBeenCalledWith('https://api.example.com/test-endpoint', expect.any(Object));
    });

    test('should make a successful static POST request', async () => {
      const requestBody = { name: 'Test User' };
      const responseData = { id: 1, name: 'Test User' };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 201,
        statusText: 'Created',
        json: async () => responseData,
        text: async () => JSON.stringify(responseData),
        headers: new Headers({ 'Content-Type': 'application/json' }),
      });

      const response = await GholaFetch.post('/users', requestBody);

      expect(response.status).toBe(201);
      expect(response.data).toEqual(responseData);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.example.com/users',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify(requestBody),
        }),
      );
    });

    test('should make a successful static PUT request', async () => {
      const requestBody = { id: 1, name: 'Updated User' };
      const responseData = { id: 1, name: 'Updated User' };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => responseData,
        text: async () => JSON.stringify(responseData),
        headers: new Headers({ 'Content-Type': 'application/json' }),
      });

      const response = await GholaFetch.put('/users/1', requestBody);

      expect(response.status).toBe(200);
      expect(response.data).toEqual(responseData);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.example.com/users/1',
        expect.objectContaining({
          method: 'PUT',
          body: JSON.stringify(requestBody),
        })
      );
    });

    test('should make a successful static DELETE request', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 204,
        statusText: 'No Content',
        text: async () => '',
        headers: new Headers({}),
      });

      const response = await GholaFetch.delete('/users/1');

      expect(response.status).toBe(204);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.example.com/users/1',
        expect.objectContaining({
          method: 'DELETE',
        })
      );
    });

    test('should allow static configuration with create method', async () => {
      // Configure a new static instance
      GholaFetch.create({ baseUrl: 'https://new-api.example.com' });

      const responseData = { data: 'test' };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => responseData,
        headers: new Headers({ 'Content-Type': 'application/json' }),
      });

      const response = await GholaFetch.get('/test-endpoint');

      expect(response.status).toBe(200);
      expect(mockFetch).toHaveBeenCalledWith('https://new-api.example.com/test-endpoint', expect.any(Object));
    });

    test('should apply static middleware', async () => {
      const preMiddleware = jest.fn(async (options) => ({
        ...options,
        options: { ...options.options, headers: { 'X-Static-Middleware': 'true' } },
      }));

      GholaFetch.use({ pre: preMiddleware });

      const responseData = { data: 'test' };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => responseData,
        headers: new Headers({ 'Content-Type': 'application/json' }),
      });

      const response = await GholaFetch.get('/test-endpoint');

      expect(preMiddleware).toHaveBeenCalled();
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.example.com/test-endpoint',
        expect.objectContaining({
          headers: { 'X-Static-Middleware': 'true' },
        })
      );
    });

    test('should support method chaining for static use() method', async () => {
      const middleware1 = { pre: jest.fn(async (options) => options) };
      const middleware2 = { pre: jest.fn(async (options) => options) };

      GholaFetch.use(middleware1).use(middleware2);

      const responseData = { data: 'test' };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => responseData,
        headers: new Headers({ 'Content-Type': 'application/json' }),
      });

      await GholaFetch.get('/test-endpoint');

      expect(middleware1.pre).toHaveBeenCalled();
      expect(middleware2.pre).toHaveBeenCalled();
    });
  });

  describe('cache', () => {
    test('should cache responses based on Cache-Control header', async () => {
      const headerBasedCache = new InMemoryCache({ maxCapacity: 2 });
      gholaFetch = new GholaFetch({
        baseUrl: 'https://api.example.com',
        cache: headerBasedCache,
      });

      const responseData = { data: 'test' };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => responseData,
        text: async () => JSON.stringify(responseData),
        headers: new Headers({ 'Content-Type': 'application/json', 'Cache-Control': 'max-age=1' }),
      });

      const response1 = await gholaFetch.get('/test-endpoint');
      const response2 = await gholaFetch.get('/test-endpoint');

      expect(response1.data).toEqual(responseData);
      expect(response2.data).toEqual(responseData);
      expect(mockFetch).toHaveBeenCalledTimes(1); // Fetch only called once due to caching

      // Wait for Cache-Control max-age to expire
      await new Promise((resolve) => setTimeout(resolve, 1500));

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => responseData,
        text: async () => JSON.stringify(responseData),
        headers: new Headers({ 'Content-Type': 'application/json', 'Cache-Control': 'max-age=1' }),
      });

      const response3 = await gholaFetch.get('/test-endpoint');
      expect(response3.data).toEqual(responseData);
      expect(mockFetch).toHaveBeenCalledTimes(2); // Fetch called twice due to Cache-Control expiration
    });

    test('should respect maxCapacity in MemoryCache and evict oldest entries', async () => {
      const inMemoryCache = new InMemoryCache({ maxCapacity: 2 });
      gholaFetch = new GholaFetch({
        baseUrl: 'https://api.example.com',
        cache: inMemoryCache,
      });

      const responseData1 = { data: 'test1' };
      const responseData2 = { data: 'test2' };
      const responseData3 = { data: 'test3' };

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          statusText: 'OK',
          json: async () => responseData1,
          text: async () => JSON.stringify(responseData1),
          headers: new Headers({ 'Content-Type': 'application/json', 'Cache-Control': 'max-age=10' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          statusText: 'OK',
          json: async () => responseData2,
          text: async () => JSON.stringify(responseData2),
          headers: new Headers({ 'Content-Type': 'application/json', 'Cache-Control': 'max-age=10' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          statusText: 'OK',
          json: async () => responseData3,
          text: async () => JSON.stringify(responseData3),
          headers: new Headers({ 'Content-Type': 'application/json', 'Cache-Control': 'max-age=10' }),
        });

      // First request should fetch and cache the response
      const response1 = await gholaFetch.get('/test-endpoint1');
      expect(response1.data).toEqual(responseData1);
      expect(mockFetch).toHaveBeenCalledTimes(1);

      // Second request should fetch and cache the response
      const response2 = await gholaFetch.get('/test-endpoint2');
      expect(response2.data).toEqual(responseData2);
      expect(mockFetch).toHaveBeenCalledTimes(2);

      // Third request should fetch and cache the response, evicting the first cached response
      const response3 = await gholaFetch.get('/test-endpoint3');
      expect(response3.data).toEqual(responseData3);
      expect(mockFetch).toHaveBeenCalledTimes(3);

      // First request should now miss the cache and fetch again
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => responseData1,
        text: async () => JSON.stringify(responseData1),
        headers: new Headers({ 'Content-Type': 'application/json', 'Cache-Control': 'max-age=10' }),
      });
      const response1Again = await gholaFetch.get('/test-endpoint1');
      expect(response1Again.data).toEqual(responseData1);
      expect(mockFetch).toHaveBeenCalledTimes(4);

      // First request should now hit the cache
      const response1Again2 = await gholaFetch.get('/test-endpoint1');
      expect(response1.data).toEqual(responseData1);
      expect(mockFetch).toHaveBeenCalledTimes(4); // No new fetch call

      // Third request should hit the cache
      const response3Again = await gholaFetch.get('/test-endpoint3');
      expect(response3Again.data).toEqual(responseData3);
      expect(mockFetch).toHaveBeenCalledTimes(4); // No new fetch call
    });

    test('should set cache key prefix in pre middleware', async () => {
      const userId = 'user-123';
      const cache = new InMemoryCache({ maxCapacity: 2 });
      gholaFetch = new GholaFetch({
        baseUrl: 'https://api.example.com',
        cache: cache,
      });

      const cacheKeyPrefixMiddleware = (userId: string): GholaMiddleware => ({
        pre: async (options: GholaRequestOptions): Promise<GholaRequestOptions> => {
          options.cache = { ...options.cache, keyPrefix: userId }; // Set the cache key prefix based on the user ID
          return options;
        }
      });

      gholaFetch.use(cacheKeyPrefixMiddleware(userId));

      const responseData = { data: 'test' };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => responseData,
        text: async () => JSON.stringify(responseData),
        headers: new Headers({ 'Content-Type': 'application/json', 'Cache-Control': 'max-age=10' }),
      });

      // First request should fetch and cache the response with the user-specific key prefix
      const response1 = await gholaFetch.get('/test-endpoint');
      expect(response1.data).toEqual(responseData);
      expect(mockFetch).toHaveBeenCalledTimes(1);

      // Check that the cache key prefix was set correctly
      const cacheKey = `${userId}-https://api.example.com/test-endpoint`;
      expect(cache.get(cacheKey)).toEqual(response1);

      // Second request should hit the cache
      const response2 = await gholaFetch.get('/test-endpoint');
      expect(response2.data).toEqual(responseData);
      expect(mockFetch).toHaveBeenCalledTimes(1); // No new fetch call
    });

    test('should cache responses in static instance', async () => {
      const staticCache = new InMemoryCache({ maxCapacity: 5 });

      // Configure static instance with cache
      GholaFetch.create({
        baseUrl: 'https://api.example.com',
        cache: staticCache,
      });

      const responseData = { data: 'static-test' };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => responseData,
        headers: new Headers({ 'Content-Type': 'application/json', 'Cache-Control': 'max-age=10' }),
      });

      // First request should fetch and cache
      const response1 = await GholaFetch.get('/static-endpoint');
      expect(response1.data).toEqual(responseData);
      expect(mockFetch).toHaveBeenCalledTimes(1);

      // Second request should use cache
      const response2 = await GholaFetch.get('/static-endpoint');
      expect(response2.data).toEqual(responseData);
      expect(mockFetch).toHaveBeenCalledTimes(1); // No additional fetch call
    });
  });
});