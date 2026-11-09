import { InMemoryCache } from '../src/cache/in-memory-cache';
import { GholaFetch } from '../src/fetch';
import { GholaFetchError } from '../src/fetch-error';
import { RetryMiddleware } from '../src/retry/retry-middleware';
import { FixedDelay } from '../src/retry/strategies';
import { GholaMiddleware, GholaRequestContext, GholaSettledOutcome } from '../src/types';

const mockFetch = jest.fn();
global.fetch = mockFetch as jest.Mock;

function mockResponse(status: number, data: any, headers: Record<string, string> = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: 'status text',
    json: async () => data,
    text: async () => JSON.stringify(data),
    headers: new Headers({ 'Content-Type': 'application/json', ...headers }),
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

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type Settled = { outcome: GholaSettledOutcome; context: GholaRequestContext };

/** A middleware that records every settled attempt */
function recorder() {
  const settled: Settled[] = [];
  const middleware: GholaMiddleware = {
    settled: (outcome, context) => {
      settled.push({ outcome, context });
    },
  };
  return { settled, middleware };
}

describe('Request context', () => {
  let gholaFetch: GholaFetch;

  beforeEach(() => {
    gholaFetch = new GholaFetch({ baseUrl: 'https://api.example.com' });
    mockFetch.mockReset();
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('shape and sharing', () => {
    test('should pass the same context to pre, post and settled', async () => {
      const seen: GholaRequestContext[] = [];
      gholaFetch.use({
        pre: (options, context) => {
          seen.push(context);
          return options;
        },
        post: (response, context) => {
          seen.push(context);
          return response;
        },
        settled: (_outcome, context) => {
          seen.push(context);
        },
      });

      mockFetch.mockResolvedValueOnce(mockResponse(200, { ok: true }));
      const before = Date.now();
      await gholaFetch.get('/users/1', { params: { expand: 'roles' } });

      expect(seen).toHaveLength(3);
      expect(seen[1]).toBe(seen[0]);
      expect(seen[2]).toBe(seen[0]);
      expect(seen[0]).toEqual({
        endpoint: '/users/1',
        method: 'GET',
        startTime: expect.any(Number),
        attempt: 1,
        fromCache: false,
        state: {},
      });
      expect(seen[0].startTime).toBeGreaterThanOrEqual(before);
      expect(seen[0].startTime).toBeLessThanOrEqual(Date.now());
    });

    test('should pass the same context to pre and error', async () => {
      let preContext: GholaRequestContext | undefined;
      let errorContext: GholaRequestContext | undefined;
      gholaFetch.use({
        pre: (options, context) => {
          preContext = context;
          return options;
        },
        error: (_error, _request, _retry, context) => {
          errorContext = context;
        },
      });

      mockFetch.mockResolvedValueOnce(mockResponse(500, {}));
      await expect(gholaFetch.post('/orders', { id: 1 })).rejects.toThrow(GholaFetchError);

      expect(errorContext).toBeDefined();
      expect(errorContext).toBe(preContext);
      expect(errorContext).toMatchObject({ endpoint: '/orders', method: 'POST', attempt: 1 });
    });

    test('should keep what a middleware stores in state across the hooks of the attempt', async () => {
      gholaFetch.use({
        pre: (options, context) => {
          context.state.startedBy = 'metrics';
          return options;
        },
        post: (response, context) => ({ ...response, data: context.state.startedBy as any }),
      });

      mockFetch.mockResolvedValueOnce(mockResponse(200, { ok: true }));
      const response = await gholaFetch.get('/test');

      expect(response.data).toBe('metrics');
    });

    test('should reflect the method set by a pre middleware', async () => {
      const { settled, middleware } = recorder();
      gholaFetch.use({ pre: (options) => ({ ...options, method: 'PUT' }) }).use(middleware);

      mockFetch.mockResolvedValueOnce(mockResponse(200, {}));
      await gholaFetch.get('/test');

      expect(settled[0].context.method).toBe('PUT');
    });

    test('should keep working with middlewares that ignore the context', async () => {
      gholaFetch.use({
        pre: (options) => options,
        post: (response) => ({ ...response, data: { wrapped: response.data } as any }),
      });

      mockFetch.mockResolvedValueOnce(mockResponse(200, { ok: true }));
      const response = await gholaFetch.get('/test');

      expect(response.data).toEqual({ wrapped: { ok: true } });
    });

    test('should work with the static instance', async () => {
      GholaFetch.create({ baseUrl: 'https://api.example.com' });
      const { settled, middleware } = recorder();
      GholaFetch.use(middleware);

      mockFetch.mockResolvedValueOnce(mockResponse(200, {}));
      await GholaFetch.delete('/items/9');

      expect(settled[0].context).toMatchObject({ endpoint: '/items/9', method: 'DELETE' });
    });
  });

  describe('isolation', () => {
    test('should give each concurrent request its own context', async () => {
      const preContexts = new Map<string, GholaRequestContext>();
      const postMismatches: string[] = [];
      const { settled, middleware } = recorder();

      gholaFetch
        .use({
          pre: async (options, context) => {
            preContexts.set(context.endpoint, context);
            context.state.id = context.endpoint;
            await delay(Math.random() * 10);
            return options;
          },
          post: (response, context) => {
            if (context.state.id !== context.endpoint || preContexts.get(context.endpoint) !== context) {
              postMismatches.push(context.endpoint);
            }
            return response;
          },
        })
        .use(middleware);

      // Responses resolve in a different order than the requests were sent
      mockFetch.mockImplementation(async (url: string) => {
        await delay(Math.random() * 20);
        if (url.endsWith('/3')) return mockResponse(500, {});
        return mockResponse(200, { url });
      });

      const endpoints = ['/r/0', '/r/1', '/r/2', '/r/3', '/r/4', '/r/5', '/r/6', '/r/7'];
      const results = await Promise.allSettled(endpoints.map((e) => gholaFetch.get(e)));

      expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
      expect(postMismatches).toEqual([]);
      expect(settled).toHaveLength(endpoints.length);

      const contexts = settled.map((s) => s.context);
      expect(new Set(contexts).size).toBe(endpoints.length);
      for (const { outcome, context } of settled) {
        expect(context).toBe(preContexts.get(context.endpoint));
        expect(context.state.id).toBe(context.endpoint);
        if (context.endpoint === '/r/3') {
          expect(outcome.error?.status).toBe(500);
        } else {
          expect(outcome.response?.data).toEqual({ url: `https://api.example.com${context.endpoint}` });
        }
      }
    });
  });

  describe('settled', () => {
    test('should be called once on success, after the post middlewares', async () => {
      const { settled, middleware } = recorder();
      gholaFetch
        .use({ post: (response) => ({ ...response, data: 'processed' as any }) })
        .use(middleware);

      mockFetch.mockResolvedValueOnce(mockResponse(200, { ok: true }));
      await gholaFetch.get('/test');

      expect(settled).toHaveLength(1);
      expect(settled[0].outcome.response?.data).toBe('processed');
      expect(settled[0].outcome.error).toBeUndefined();
    });

    test('should be called once on an HTTP error, before the error middlewares', async () => {
      const order: string[] = [];
      gholaFetch.use({
        settled: () => {
          order.push('settled');
        },
        error: () => {
          order.push('error');
        },
      });

      mockFetch.mockResolvedValueOnce(mockResponse(404, {}));
      await expect(gholaFetch.get('/test')).rejects.toThrow();

      expect(order).toEqual(['settled', 'error']);
    });

    test('should report the error even when an error middleware recovers with a fallback', async () => {
      const { settled, middleware } = recorder();
      gholaFetch.use(middleware).use({
        error: () => ({ headers: new Headers(), status: 200, statusText: 'OK', data: 'fallback' as any }),
      });

      mockFetch.mockResolvedValueOnce(mockResponse(503, {}));
      const response = await gholaFetch.get('/test');

      expect(response.data).toBe('fallback');
      expect(settled).toHaveLength(1);
      expect(settled[0].outcome.error?.status).toBe(503);
    });

    test.each([
      ['timeout', () => mockFetch.mockImplementationOnce(hangingFetch), { timeout: 10 }],
      ['network', () => mockFetch.mockRejectedValueOnce(new TypeError('Failed to fetch')), {}],
      [
        'aborted',
        () => mockFetch.mockImplementationOnce(hangingFetch),
        {
          signal: (() => {
            const c = new AbortController();
            c.abort();
            return c.signal;
          })(),
        },
      ],
    ])('should be called with a %s error', async (kind, arrange, options) => {
      const { settled, middleware } = recorder();
      gholaFetch.use(middleware);
      arrange();

      await expect(gholaFetch.get('/test', options)).rejects.toThrow();

      expect(settled).toHaveLength(1);
      expect(settled[0].outcome.error?.kind).toBe(kind);
    });

    test('should be called with an unknown error when a pre middleware throws', async () => {
      const { settled, middleware } = recorder();
      gholaFetch
        .use({
          pre: () => {
            throw new Error('no token');
          },
        })
        .use(middleware);

      await expect(gholaFetch.get('/test')).rejects.toThrow();

      expect(settled).toHaveLength(1);
      expect(settled[0].outcome.error?.kind).toBe('unknown');
    });

    test('should be called only once, with the error, when a post middleware throws', async () => {
      const { settled, middleware } = recorder();
      gholaFetch
        .use({
          post: () => {
            throw new Error('bad shape');
          },
        })
        .use(middleware);

      mockFetch.mockResolvedValueOnce(mockResponse(200, {}));
      await expect(gholaFetch.get('/test')).rejects.toThrow();

      expect(settled).toHaveLength(1);
      expect(settled[0].outcome.error?.kind).toBe('unknown');
    });

    test('should not affect the request when it throws or rejects', async () => {
      const after = jest.fn();
      gholaFetch
        .use({
          settled: () => {
            throw new Error('sync boom');
          },
        })
        .use({ settled: () => Promise.reject(new Error('async boom')) })
        .use({ settled: after });

      mockFetch.mockResolvedValueOnce(mockResponse(200, { ok: true }));
      const response = await gholaFetch.get('/test');
      await delay(0); // let the rejected promise be handled

      expect(response.data).toEqual({ ok: true });
      expect(after).toHaveBeenCalledTimes(1);
      expect(console.error).toHaveBeenCalledWith(
        'GholaFetch: settled middleware failed:',
        expect.objectContaining({ message: 'sync boom' })
      );
      expect(console.error).toHaveBeenCalledWith(
        'GholaFetch: settled middleware failed:',
        expect.objectContaining({ message: 'async boom' })
      );
    });

    test('should not wait for an async settled hook', async () => {
      let finished = false;
      gholaFetch.use({
        settled: async () => {
          await delay(50);
          finished = true;
        },
      });

      mockFetch.mockResolvedValueOnce(mockResponse(200, {}));
      await gholaFetch.get('/test');

      expect(finished).toBe(false);
    });
  });

  describe('retries', () => {
    test('should create a new context per attempt, with attempt incremented', async () => {
      const { settled, middleware } = recorder();
      gholaFetch.use(middleware).use(RetryMiddleware({ strategy: new FixedDelay(5) }));

      mockFetch
        .mockResolvedValueOnce(mockResponse(503, {}))
        .mockRejectedValueOnce(new TypeError('Failed to fetch'))
        .mockResolvedValueOnce(mockResponse(200, { ok: true }));

      await gholaFetch.get('/test');

      expect(settled.map((s) => s.context.attempt)).toEqual([1, 2, 3]);
      expect(settled.map((s) => s.outcome.error?.kind ?? 'ok')).toEqual(['http', 'network', 'ok']);
      expect(new Set(settled.map((s) => s.context)).size).toBe(3);
      expect(settled.map((s) => s.context.state)).toEqual([{}, {}, {}]);
      // Each attempt starts after the previous one (FixedDelay(5) between them)
      expect(settled[1].context.startTime).toBeGreaterThan(settled[0].context.startTime);
      expect(settled[2].context.startTime).toBeGreaterThan(settled[1].context.startTime);
    });

    test('should report every attempt even when registered after RetryMiddleware', async () => {
      const { settled, middleware } = recorder();
      gholaFetch.use(RetryMiddleware({ strategy: new FixedDelay(0), maxRetries: 2 })).use(middleware);

      mockFetch.mockResolvedValue(mockResponse(503, {}));

      await expect(gholaFetch.get('/test')).rejects.toMatchObject({ status: 503 });

      expect(settled.map((s) => s.context.attempt)).toEqual([1, 2, 3]);
      expect(settled.every((s) => s.outcome.error?.status === 503)).toBe(true);
    });

    test('should increment attempt when a custom error middleware calls retry()', async () => {
      const { settled, middleware } = recorder();
      gholaFetch.use(middleware).use({
        error: (error, request, retry, context) => {
          if (context.attempt < 2) return retry(request);
          throw error;
        },
      });

      mockFetch
        .mockResolvedValueOnce(mockResponse(500, {}))
        .mockResolvedValueOnce(mockResponse(200, {}));

      await gholaFetch.get('/test');

      expect(settled.map((s) => s.context.attempt)).toEqual([1, 2]);
    });

    test('should run pre again on each attempt with that attempt context', async () => {
      const attempts: number[] = [];
      gholaFetch
        .use({
          pre: (options, context) => {
            attempts.push(context.attempt);
            return options;
          },
        })
        .use(RetryMiddleware({ strategy: new FixedDelay(0) }));

      mockFetch
        .mockResolvedValueOnce(mockResponse(503, {}))
        .mockResolvedValueOnce(mockResponse(200, {}));

      await gholaFetch.get('/test');

      expect(attempts).toEqual([1, 2]);
    });

    test('should keep headers set by a pre middleware across retries', async () => {
      let counter = 0;
      gholaFetch
        .use({
          pre: (options) => {
            if (!options.options?.headers?.has('X-Request-Id')) {
              options.options?.headers?.set('X-Request-Id', `req-${++counter}`);
            }
            return options;
          },
        })
        .use(RetryMiddleware({ strategy: new FixedDelay(0) }));

      mockFetch
        .mockResolvedValueOnce(mockResponse(503, {}))
        .mockResolvedValueOnce(mockResponse(200, {}));

      await gholaFetch.get('/test');

      const sentIds = mockFetch.mock.calls.map(([, init]) => (init.headers as Headers).get('X-Request-Id'));
      expect(sentIds).toEqual(['req-1', 'req-1']);
    });
  });

  describe('cache', () => {
    test('should mark a cached response with fromCache and not run post again', async () => {
      gholaFetch = new GholaFetch({
        baseUrl: 'https://api.example.com',
        cache: new InMemoryCache({ maxCapacity: 10 }),
      });
      const post = jest.fn((response) => response);
      const { settled, middleware } = recorder();
      gholaFetch.use({ post }).use(middleware);

      mockFetch.mockResolvedValueOnce(mockResponse(200, { ok: true }, { 'Cache-Control': 'max-age=60' }));

      const first = await gholaFetch.get('/cached');
      const second = await gholaFetch.get('/cached');

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(post).toHaveBeenCalledTimes(1);
      expect(second.data).toEqual(first.data);
      expect(settled.map((s) => s.context.fromCache)).toEqual([false, true]);
      expect(settled[1].outcome.response?.data).toEqual({ ok: true });
    });

    test('should still report a response that is not cached because of Vary: *', async () => {
      gholaFetch = new GholaFetch({
        baseUrl: 'https://api.example.com',
        cache: new InMemoryCache({ maxCapacity: 10 }),
      });
      const { settled, middleware } = recorder();
      gholaFetch.use(middleware);

      mockFetch.mockResolvedValue(
        mockResponse(200, { ok: true }, { 'Cache-Control': 'max-age=60', Vary: '*' })
      );

      await gholaFetch.get('/vary');
      await gholaFetch.get('/vary');

      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(settled.map((s) => s.context.fromCache)).toEqual([false, false]);
    });
  });
});
