import { GholaFetch } from '../src/fetch';
import { GholaFetchError } from '../src/fetch-error';
import { RetryMiddleware } from '../src/retry/retry-middleware';
import { ExponentialBackoff, FixedDelay } from '../src/retry/strategies';

const mockFetch = jest.fn();
global.fetch = mockFetch as jest.Mock;

function mockOkResponse(status: number, data: any, headers: Record<string, string> = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: 'status text',
    json: async () => data,
    text: async () => JSON.stringify(data),
    headers: new Headers({ 'Content-Type': 'application/json', ...headers }),
  };
}

describe('RetryMiddleware', () => {
  let gholaFetch: GholaFetch;

  beforeEach(() => {
    gholaFetch = new GholaFetch({ baseUrl: 'https://api.example.com' });
    mockFetch.mockReset();
  });

  test('should retry a GET request on a retryable status code and return the successful response', async () => {
    gholaFetch.use(RetryMiddleware({ strategy: new FixedDelay(0) }));

    mockFetch
      .mockResolvedValueOnce(mockOkResponse(503, { message: 'Service Unavailable' }))
      .mockResolvedValueOnce(mockOkResponse(200, { ok: true }));

    const response = await gholaFetch.get('/test');

    expect(response.status).toBe(200);
    expect(response.data).toEqual({ ok: true });
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  test('should not retry POST requests by default', async () => {
    gholaFetch.use(RetryMiddleware({ strategy: new FixedDelay(0) }));

    mockFetch.mockResolvedValueOnce(mockOkResponse(503, { message: 'Service Unavailable' }));

    await expect(gholaFetch.post('/test', { foo: 'bar' })).rejects.toThrow(GholaFetchError);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  test('should retry POST requests when explicitly opted in via methods', async () => {
    gholaFetch.use(RetryMiddleware({ strategy: new FixedDelay(0), methods: { POST: true } }));

    mockFetch
      .mockResolvedValueOnce(mockOkResponse(503, { message: 'Service Unavailable' }))
      .mockResolvedValueOnce(mockOkResponse(200, { ok: true }));

    const response = await gholaFetch.post('/test', { foo: 'bar' });

    expect(response.status).toBe(200);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  test('should not retry on a non-matching status code', async () => {
    gholaFetch.use(RetryMiddleware({ strategy: new FixedDelay(0) }));

    mockFetch.mockResolvedValueOnce(mockOkResponse(404, { message: 'Not Found' }));

    await expect(gholaFetch.get('/test')).rejects.toThrow(GholaFetchError);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  test('should retry on a network error (no response received)', async () => {
    gholaFetch.use(RetryMiddleware({ strategy: new FixedDelay(0) }));

    mockFetch
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(mockOkResponse(200, { ok: true }));

    const response = await gholaFetch.get('/test');

    expect(response.status).toBe(200);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  test('should stop retrying after maxRetries and propagate the original error', async () => {
    gholaFetch.use(RetryMiddleware({ strategy: new FixedDelay(0), maxRetries: 2 }));

    mockFetch.mockResolvedValue(mockOkResponse(503, { message: 'Service Unavailable' }));

    await expect(gholaFetch.get('/test')).rejects.toMatchObject({ status: 503 });
    // 1 original attempt + 2 retries
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  test('should carry the attempt counter across multiple retries instead of resetting it', async () => {
    gholaFetch.use(RetryMiddleware({ strategy: new FixedDelay(0), maxRetries: 3 }));

    mockFetch
      .mockResolvedValueOnce(mockOkResponse(503, {}))
      .mockResolvedValueOnce(mockOkResponse(503, {}))
      .mockResolvedValueOnce(mockOkResponse(503, {}))
      .mockResolvedValueOnce(mockOkResponse(200, { ok: true }));

    const response = await gholaFetch.get('/test');

    expect(response.status).toBe(200);
    expect(mockFetch).toHaveBeenCalledTimes(4);
  });

  test('should respect a per-verb maxRetries override', async () => {
    gholaFetch.use(
      RetryMiddleware({
        strategy: new FixedDelay(0),
        maxRetries: 5,
        methods: { GET: { maxRetries: 1 } },
      })
    );

    mockFetch.mockResolvedValue(mockOkResponse(503, {}));

    await expect(gholaFetch.get('/test')).rejects.toMatchObject({ status: 503 });
    // 1 original attempt + 1 retry (per-verb override wins over the global maxRetries)
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  test('should invoke onRetry with attempt, delay and error info', async () => {
    const onRetry = jest.fn();
    gholaFetch.use(RetryMiddleware({ strategy: new FixedDelay(0), onRetry }));

    mockFetch
      .mockResolvedValueOnce(mockOkResponse(429, {}))
      .mockResolvedValueOnce(mockOkResponse(200, { ok: true }));

    await gholaFetch.get('/test');

    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onRetry).toHaveBeenCalledWith(
      expect.objectContaining({
        attempt: 1,
        delay: 0,
        error: expect.objectContaining({ status: 429 }),
      })
    );
  });

  test('should prefer the Retry-After header (seconds) over the configured strategy delay', async () => {
    const onRetry = jest.fn();
    gholaFetch.use(RetryMiddleware({ strategy: new FixedDelay(999_999), onRetry }));

    mockFetch
      .mockResolvedValueOnce(mockOkResponse(503, {}, { 'Retry-After': '0' }))
      .mockResolvedValueOnce(mockOkResponse(200, { ok: true }));

    const response = await gholaFetch.get('/test');

    expect(response.status).toBe(200);
    expect(onRetry).toHaveBeenCalledWith(expect.objectContaining({ delay: 0 }));
  });

  test('should ignore the Retry-After header when respectRetryAfter is false', async () => {
    const onRetry = jest.fn();
    gholaFetch.use(RetryMiddleware({ strategy: new FixedDelay(0), respectRetryAfter: false, onRetry }));

    mockFetch
      .mockResolvedValueOnce(mockOkResponse(503, {}, { 'Retry-After': '999' }))
      .mockResolvedValueOnce(mockOkResponse(200, { ok: true }));

    await gholaFetch.get('/test');

    expect(onRetry).toHaveBeenCalledWith(expect.objectContaining({ delay: 0 }));
  });

  test('should compute the delay from the configured strategy based on the attempt number', async () => {
    const onRetry = jest.fn();
    gholaFetch.use(RetryMiddleware({ strategy: new ExponentialBackoff(10, 2, 10_000), onRetry }));

    mockFetch
      .mockResolvedValueOnce(mockOkResponse(503, {}))
      .mockResolvedValueOnce(mockOkResponse(503, {}))
      .mockResolvedValueOnce(mockOkResponse(200, { ok: true }));

    await gholaFetch.get('/test');

    expect(onRetry).toHaveBeenNthCalledWith(1, expect.objectContaining({ attempt: 1, delay: 10 }));
    expect(onRetry).toHaveBeenNthCalledWith(2, expect.objectContaining({ attempt: 2, delay: 20 }));
  });
});
