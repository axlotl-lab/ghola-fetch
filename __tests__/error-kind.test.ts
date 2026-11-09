import { GholaFetch } from '../src/fetch';
import { GholaFetchError } from '../src/fetch-error';
import { GholaMiddleware } from '../src/types';

const mockFetch = jest.fn();
global.fetch = mockFetch as jest.Mock;

function mockResponse(status: number, data: any) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: 'status text',
    json: async () => data,
    text: async () => JSON.stringify(data),
    headers: new Headers({ 'Content-Type': 'application/json' }),
  };
}

const abortError = () => new DOMException('The operation was aborted.', 'AbortError');

/** A fetch that never resolves and rejects like the real one when its signal aborts */
function hangingFetch(_url: string, init: RequestInit) {
  return new Promise((_resolve, reject) => {
    if (init.signal?.aborted) {
      reject(init.signal.reason ?? abortError());
      return;
    }
    init.signal?.addEventListener('abort', () => reject(init.signal?.reason ?? abortError()));
  });
}

describe('GholaFetchError kind', () => {
  let gholaFetch: GholaFetch;

  beforeEach(() => {
    gholaFetch = new GholaFetch({ baseUrl: 'https://api.example.com' });
    mockFetch.mockReset();
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('constructor', () => {
    test('should default to http when status >= 400', () => {
      expect(new GholaFetchError('x', 404).kind).toBe('http');
    });

    test('should default to unknown when status < 400', () => {
      expect(new GholaFetchError('x', 0).kind).toBe('unknown');
    });

    test('should use the explicit kind when given', () => {
      expect(new GholaFetchError('x', 0, undefined, 'network').kind).toBe('network');
    });
  });

  test('should be http for a non-2xx response', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(500, { message: 'boom' }));

    await expect(gholaFetch.get('/test')).rejects.toMatchObject({ kind: 'http', status: 500 });
  });

  test('should be timeout when the configured timeout is exceeded', async () => {
    mockFetch.mockImplementationOnce(hangingFetch);

    await expect(gholaFetch.get('/test', { timeout: 10 })).rejects.toMatchObject({
      kind: 'timeout',
      status: 408,
      message: 'Request timeout',
    });
  });

  test('should be timeout when both a signal and a timeout are given and the timeout wins', async () => {
    mockFetch.mockImplementationOnce(hangingFetch);
    const controller = new AbortController();

    await expect(
      gholaFetch.get('/test', { timeout: 10, signal: controller.signal })
    ).rejects.toMatchObject({ kind: 'timeout', status: 408 });
  });

  test('should be timeout when the external signal aborts with a TimeoutError', async () => {
    mockFetch.mockImplementationOnce(hangingFetch);

    await expect(
      gholaFetch.get('/test', { signal: AbortSignal.timeout(10) })
    ).rejects.toMatchObject({ kind: 'timeout', status: 408 });
  });

  test('should be aborted when the external signal is aborted during the request', async () => {
    mockFetch.mockImplementationOnce(hangingFetch);
    const controller = new AbortController();

    const promise = gholaFetch.get('/test', { signal: controller.signal });
    setTimeout(() => controller.abort(), 10);

    await expect(promise).rejects.toMatchObject({ kind: 'aborted', status: 408 });
  });

  test('should be aborted when the external signal was already aborted', async () => {
    mockFetch.mockImplementationOnce(hangingFetch);
    const controller = new AbortController();
    controller.abort();

    await expect(gholaFetch.get('/test', { signal: controller.signal })).rejects.toMatchObject({
      kind: 'aborted',
    });
  });

  test('should be aborted when the signal is aborted with a custom reason', async () => {
    mockFetch.mockImplementationOnce(hangingFetch);
    const controller = new AbortController();
    controller.abort(new Error('user navigated away'));

    await expect(gholaFetch.get('/test', { signal: controller.signal })).rejects.toMatchObject({
      kind: 'aborted',
    });
  });

  test('should be aborted (not timeout) when the signal aborts before a configured timeout', async () => {
    mockFetch.mockImplementationOnce(hangingFetch);
    const controller = new AbortController();

    const promise = gholaFetch.get('/test', { signal: controller.signal, timeout: 1000 });
    setTimeout(() => controller.abort(), 10);

    await expect(promise).rejects.toMatchObject({ kind: 'aborted' });
  });

  test('should be network when fetch itself fails', async () => {
    mockFetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));

    await expect(gholaFetch.get('/test')).rejects.toMatchObject({ kind: 'network', status: 0 });
  });

  test('should be unknown when a pre middleware throws a plain error', async () => {
    gholaFetch.use({
      pre: () => {
        throw new Error('no token');
      },
    });

    await expect(gholaFetch.get('/test')).rejects.toMatchObject({ kind: 'unknown', status: 0 });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  test('should be unknown when a post middleware throws a plain error', async () => {
    mockFetch.mockResolvedValueOnce(mockResponse(200, { ok: true }));
    gholaFetch.use({
      post: () => {
        throw new Error('bad shape');
      },
    });

    await expect(gholaFetch.get('/test')).rejects.toMatchObject({ kind: 'unknown', status: 0 });
  });

  test('should keep the kind of a GholaFetchError thrown by a middleware', async () => {
    gholaFetch.use({
      pre: () => {
        throw new GholaFetchError('unauthorized', 401);
      },
    });

    await expect(gholaFetch.get('/test')).rejects.toMatchObject({ kind: 'http', status: 401 });
  });

  test('should pass the error with its kind to the error middleware for non-HTTP errors', async () => {
    const kinds: string[] = [];
    const middleware: GholaMiddleware = {
      error: (error) => {
        kinds.push(error.kind);
      },
    };
    gholaFetch.use(middleware);

    mockFetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await expect(gholaFetch.get('/network')).rejects.toThrow();

    mockFetch.mockImplementationOnce(hangingFetch);
    await expect(gholaFetch.get('/timeout', { timeout: 10 })).rejects.toThrow();

    const controller = new AbortController();
    controller.abort();
    mockFetch.mockImplementationOnce(hangingFetch);
    await expect(gholaFetch.get('/aborted', { signal: controller.signal })).rejects.toThrow();

    expect(kinds).toEqual(['network', 'timeout', 'aborted']);
  });
});
