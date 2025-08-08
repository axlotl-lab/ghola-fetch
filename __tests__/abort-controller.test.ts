import { GholaFetch } from '../src/fetch';

describe('GholaFetch AbortController Support', () => {
  it('should accept an external AbortSignal and cancel the request when aborted', async () => {
    const controller = new AbortController();
    const client = new GholaFetch();

    // Simulate a delayed response
    const mockFetch = jest.fn().mockImplementation((url, options) => {
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          resolve(new Response(JSON.stringify({ success: true }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          }));
        }, 1000);

        // Listen for abort signal
        if (options.signal) {
          options.signal.addEventListener('abort', () => {
            clearTimeout(timeout);
            reject(new Error('AbortError'));
          });
        }
      });
    });

    global.fetch = mockFetch;

    // Start the request
    const requestPromise = client.get('/test', {
      signal: controller.signal
    });

    // Abort the request after 100ms
    setTimeout(() => {
      controller.abort();
    }, 100);

    // The request should be aborted
    await expect(requestPromise).rejects.toThrow();
    
    // Verify that fetch was called with the correct signal
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/test'),
      expect.objectContaining({
        signal: controller.signal
      })
    );
  });

  it('should work with static methods and external AbortSignal', async () => {
    const controller = new AbortController();

    const mockFetch = jest.fn().mockImplementation((url, options) => {
      return new Promise((resolve, reject) => {
        if (options.signal?.aborted) {
          reject(new Error('AbortError'));
          return;
        }
        
        const timeout = setTimeout(() => {
          resolve(new Response(JSON.stringify({ data: 'test' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          }));
        }, 500);

        if (options.signal) {
          options.signal.addEventListener('abort', () => {
            clearTimeout(timeout);
            reject(new Error('AbortError'));
          });
        }
      });
    });

    global.fetch = mockFetch;

    // Abort before making the request
    controller.abort();

    // The request should be aborted immediately
    await expect(GholaFetch.get('/test', {
      signal: controller.signal
    })).rejects.toThrow();

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining('/test'),
      expect.objectContaining({
        signal: controller.signal
      })
    );
  });

  it('should combine external signal with timeout', async () => {
    const controller = new AbortController();

    const mockFetch = jest.fn().mockImplementation((url, options) => {
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          resolve(new Response(JSON.stringify({ data: 'test' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
          }));
        }, 2000);

        if (options.signal) {
          options.signal.addEventListener('abort', () => {
            clearTimeout(timeout);
            reject(new Error('AbortError'));
          });
        }
      });
    });

    global.fetch = mockFetch;

    const client = new GholaFetch();

    // Start request with both external signal and timeout
    const requestPromise = client.get('/test', {
      signal: controller.signal,
      timeout: 1000
    });

    // Should be aborted by timeout (1000ms) before the mock response (2000ms)
    await expect(requestPromise).rejects.toThrow();

    // Verify that fetch was called
    expect(mockFetch).toHaveBeenCalled();
    const callArgs = mockFetch.mock.calls[0];
    expect(callArgs[1]).toHaveProperty('signal');
    expect(callArgs[1].signal).toBeInstanceOf(AbortSignal);
  });
});