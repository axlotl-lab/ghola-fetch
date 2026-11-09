# GholaFetch

A modern, flexible and powerful HTTP client for browser and Node.js environments, built on top of the Fetch API. Named after the "Ghola" concept from Frank Herbert's Dune series, this library recreates and enhances the native fetch functionality with additional features.

[![npm version](https://img.shields.io/npm/v/@axlotl-lab/ghola-fetch.svg)](https://www.npmjs.com/package/@axlotl-lab/ghola-fetch)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## Features

- Built on the native Fetch API
- Supports both instance and static usage patterns (like Axios)
- Powerful middleware system for request/response transformation, with a per-request context for metrics and logging
- Automatic content type detection and parsing
- Integrated caching with Cache-Control support
- Configurable retry with pluggable backoff strategies for idempotent requests
- Comprehensive error handling
- TypeScript support
- Works in both browser and Node.js environments

## Installation

```bash
# Using npm
npm install @axlotl-lab/ghola-fetch
```

## Basic Usage

### Static Usage (Similar to Axios)

```typescript
import { GholaFetch } from '@axlotl-lab/ghola-fetch';

// Optional global configuration
GholaFetch.create({
  baseUrl: 'https://api.example.com',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer your-token'
  }
});

// Simple GET request
const getUserData = async () => {
  try {
    const response = await GholaFetch.get('/users/123');
    console.log(response.data);
  } catch (error) {
    console.error('Error fetching user:', error);
  }
};

// POST request with data
const createUser = async () => {
  try {
    const response = await GholaFetch.post('/users', {
      body: {
        name: 'John Doe',
        email: 'john@example.com'
      }
    });
    console.log('User created:', response.data);
  } catch (error) {
    console.error('Error creating user:', error);
  }
};
```

### Instance Usage (For Multiple Configurations)

```typescript
import { GholaFetch } from '@axlotl-lab/ghola-fetch';

// Create instance for specific API
const usersApi = new GholaFetch({
  baseUrl: 'https://api.users.example.com',
  headers: {
    'Authorization': 'Bearer users-api-token'
  }
});

// Create another instance for a different API
const productsApi = new GholaFetch({
  baseUrl: 'https://api.products.example.com',
  headers: {
    'Authorization': 'Bearer products-api-token'
  }
});

// Use different instances
const fetchData = async () => {
  const users = await usersApi.get('/users');
  const products = await productsApi.get('/products');
  
  return { users: users.data, products: products.data };
};
```

## Advanced Usage

### Working with Middleware

Middlewares allow you to intercept and transform requests before they are sent and responses before they are returned:

```typescript
import { GholaFetch, GholaMiddleware } from '@axlotl-lab/ghola-fetch';

// Authentication middleware
const authMiddleware: GholaMiddleware = {
  pre: async (options) => {
    // Add authentication token to all requests
    const token = localStorage.getItem('auth_token');
    if (token) {
      options.options = options.options || {};
      options.options.headers = options.options.headers || {};
      options.options.headers['Authorization'] = `Bearer ${token}`;
    }
    return options;
  }
};

// Logging middleware
const loggingMiddleware: GholaMiddleware = {
  pre: async (options, context) => {
    console.log(`Request: ${context.method} ${context.endpoint}`);
    return options;
  },
  post: async (response, context) => {
    console.log(`Response status: ${response.status} (${context.endpoint})`);
    return response;
  }
};

// Error handling middleware
const errorMiddleware: GholaMiddleware = {
  post: async (response) => {
    if (response.status === 401) {
      // Handle unauthorized access
      window.location.href = '/login';
    }
    return response;
  }
};

// Add middlewares to the global instance
GholaFetch.use(authMiddleware);
GholaFetch.use(loggingMiddleware);
GholaFetch.use(errorMiddleware);

// Or add middlewares to a specific instance
const api = new GholaFetch({ baseUrl: 'https://api.example.com' });
api.use(authMiddleware)
   .use(loggingMiddleware)
   .use(errorMiddleware);
```

### Request Context

Every hook receives a per-attempt context as its last argument. It's optional: middlewares that don't declare it keep working as before.

```typescript
type GholaMiddleware = {
  pre?: (options: GholaRequestOptions, context: GholaRequestContext) => GholaRequestOptions | Promise<GholaRequestOptions>;
  post?: <T>(response: GholaResponse<T>, context: GholaRequestContext) => GholaResponse<T> | Promise<GholaResponse<T>>;
  error?: <T>(error: GholaFetchError<T>, request: GholaRequest, retry: RequestRetryFunction, context: GholaRequestContext) => void | GholaResponse<T> | Promise<GholaResponse<T>>;
  settled?: (outcome: GholaSettledOutcome, context: GholaRequestContext) => void | Promise<void>;
};

type GholaRequestContext = {
  endpoint: string;               // as passed to request(), without baseUrl or `params`
  method: HttpMethod;             // updated after the pre middlewares, in case one changed it
  startTime: number;              // Date.now() when the attempt started, before the pre middlewares
  attempt: number;                // 1 for the original request, +1 for each retry
  fromCache: boolean;             // true when the response came from the internal cache
  state: Record<string, unknown>; // free space for middlewares to share data across hooks
};

type GholaSettledOutcome<T = any> =
  | { response: GholaResponse<T>; error?: undefined }
  | { error: GholaFetchError<T>; response?: undefined };
```

The context is the same object across all the hooks of one attempt, and a new one for each attempt, so concurrent requests never share it. It uses only standard APIs, so it behaves the same in the browser and in Node.js.

#### The `settled` hook

`settled` is an observation-only hook, called **exactly once per attempt** when it ends:

- **Success**: after the `post` middlewares, with the processed response.
- **Any error** (`http`, `timeout`, `aborted`, `network` or `unknown`, see [Error kinds](#error-kinds)): with the error, *before* the `error` middlewares run. The attempt is reported as failed even if an `error` middleware later recovers it or retries it.
- **Cache hit**: with the cached response and `context.fromCache === true`. `post` middlewares do **not** run on cache hits, because the cached response was already processed by them.

It can't change the outcome, it isn't awaited (it never delays the response), and anything it throws or rejects with is logged and ignored. That makes it the right place for metrics and logging.

#### Retries

Each retry is a new attempt: it gets a **new context** with `attempt` incremented, a new `startTime` and an empty `state`, and runs the `pre` middlewares again. This applies to `RetryMiddleware` and to any `error` middleware that calls `retry()`. Since `settled` is called once per attempt, a request that succeeds on its third try reports three attempts, whatever the order the middlewares were registered in.

To correlate the attempts of one call (or send an idempotency key), set a header in `pre` only when it isn't there yet. Retries reuse the options already processed by `pre`, so the header is kept:

```typescript
const requestIdMiddleware: GholaMiddleware = {
  pre: (options) => {
    if (!options.options?.headers?.has('X-Request-Id')) {
      options.options?.headers?.set('X-Request-Id', crypto.randomUUID());
    }
    return options;
  },
};
```

#### Example: measuring every request

```typescript
import { GholaFetch, GholaMiddleware } from '@axlotl-lab/ghola-fetch';

const metricsMiddleware = (service: string): GholaMiddleware => ({
  settled: ({ response, error }, context) => {
    if (context.fromCache) return; // or report it with a `cached` tag

    sendMetric({
      service,
      method: context.method,
      endpoint: context.endpoint,
      attempt: context.attempt,
      status: response?.status ?? error?.status,
      errorKind: error?.kind, // undefined on success
      durationMs: Date.now() - context.startTime,
    });
  },
});

const api = new GholaFetch({ baseUrl: 'https://api.example.com' });
api.use(metricsMiddleware('users-api'));
```

`durationMs` includes the time spent in the `pre` middlewares (e.g. a token refresh). To leave it out, store `Date.now()` in `context.state` from a `pre` middleware registered last and use that instead of `startTime`.

### Handling Different Content Types

GholaFetch automatically detects and parses different response types based on the Content-Type header:

```typescript
// JSON data (default)
const getJsonData = async () => {
  const response = await GholaFetch.get('/api/data');
  console.log(response.data); // Automatically parsed JSON
};

// Text content
const getTextData = async () => {
  const response = await GholaFetch.get('/api/text');
  console.log(response.data); // Text string
};

// Binary data
const getBinaryData = async () => {
  const response = await GholaFetch.get('/api/binary');
  // For endpoints that return binary data with Content-Type: application/octet-stream
  const binaryData = response.data; // Blob object in browser, Buffer in Node.js
};

// Form data
const submitFormData = async () => {
  const formData = new FormData();
  formData.append('name', 'John Doe');
  formData.append('avatar', fileInput.files[0]);
  
  const response = await GholaFetch.post('/api/upload', {
    body: formData
    // No need to set Content-Type, it's handled automatically
  });
};
```

### Caching

GholaFetch supports response caching based on Cache-Control headers:

```typescript
import { GholaFetch, MemoryCache } from '@axlotl-lab/ghola-fetch';

// Create a memory cache
const cache = new MemoryCache();

// Configure GholaFetch with cache
GholaFetch.create({
  baseUrl: 'https://api.example.com',
  cache
});

// Requests to the same endpoint will be cached according to Cache-Control headers
const getData = async () => {
  // First call fetches from server
  const response1 = await GholaFetch.get('/api/data');
  
  // Second call might return from cache if the server sent appropriate Cache-Control headers
  const response2 = await GholaFetch.get('/api/data');
};
```

### Retry with Backoff

`RetryMiddleware` adds configurable retry-with-backoff for transient failures. It's a regular middleware, so it's opt-in via `.use()` like any other:

```typescript
import { GholaFetch, RetryMiddleware } from '@axlotl-lab/ghola-fetch';

GholaFetch.create({ baseUrl: 'https://api.example.com' });

// Defaults: retries GET/PUT/DELETE/PATCH (POST is opt-in), up to 3 times,
// on 502/503/504/429 responses and on network/timeout errors,
// with exponential backoff + jitter, honoring a Retry-After header when present.
GholaFetch.use(RetryMiddleware());
```

Requests cancelled through their `signal` (`error.kind === 'aborted'`) are never retried, whatever the configuration.

By default, `POST` is **not** retried, since it's typically not idempotent. Enable it explicitly per verb, and override any option (max retries, status codes, strategy) globally or per verb:

```typescript
import {
  GholaFetch,
  RetryMiddleware,
  FixedDelay,
  ExponentialBackoff,
} from '@axlotl-lab/ghola-fetch';

GholaFetch.use(
  RetryMiddleware({
    maxRetries: 3,
    strategy: new ExponentialBackoff(200, 2, 10_000), // base 200ms, factor 2, capped at 10s
    condition: { statusCodes: [502, 503, 504, 429], onNetworkError: true },
    methods: {
      // Opt-in POST, but only for a specific idempotency-safe endpoint's client,
      // with its own (smaller) retry budget and backoff
      POST: { enabled: true, maxRetries: 1, strategy: new FixedDelay(500) },
    },
    onRetry: ({ attempt, delay, error }) => {
      console.warn(`Retrying (attempt ${attempt}) after ${delay}ms due to`, error.message);
    },
  })
);
```

Built-in strategies implement the `RetryStrategy` interface (`getDelay(attempt: number): number`), so you can also plug in your own:

```typescript
import { RetryStrategy } from '@axlotl-lab/ghola-fetch';

class LinearBackoff implements RetryStrategy {
  constructor(private stepMs: number) {}
  getDelay(attempt: number) {
    return this.stepMs * attempt;
  }
}

GholaFetch.use(RetryMiddleware({ strategy: new LinearBackoff(300) }));
```

### Error Handling

GholaFetch provides comprehensive error handling:

```typescript
import { GholaFetch, GholaFetchError } from '@axlotl-lab/ghola-fetch';

const handleData = async () => {
  try {
    const response = await GholaFetch.get('/api/data');
    return response.data;
  } catch (error) {
    if (error instanceof GholaFetchError) {
      // Access to the response object
      console.error(`HTTP Error ${error.status}: ${error.message}`);
      
      // Original response data might contain error details from the server
      if (error.response && error.response.data) {
        console.error('Server message:', error.response.data);
      }
      
      // Handle specific error codes
      if (error.status === 404) {
        return { notFound: true };
      } else if (error.status === 401) {
        // Redirect to login
        window.location.href = '/login';
      }
    } else {
      // Network errors or other unexpected errors
      console.error('Unexpected error:', error);
    }
    
    // Return fallback data
    return { error: true, message: 'Failed to fetch data' };
  }
};
```

#### Error kinds

Every `GholaFetchError` has a `kind` that tells what caused it, both when it's caught and inside `error` middlewares (which run for every kind, not only for HTTP errors):

| `kind`    | When                                                                          | `status` |
| --------- | ----------------------------------------------------------------------------- | -------- |
| `http`    | The server answered with a status >= 400                                      | The response status |
| `timeout` | The `timeout` option was exceeded, or the `signal` aborted with a `TimeoutError` (e.g. `AbortSignal.timeout()`) | `408` |
| `aborted` | The request was cancelled through the `signal` option                         | `408` |
| `network` | `fetch` itself failed (DNS, connection refused, CORS, offline...)             | `0` |
| `unknown` | Anything else, e.g. a middleware threw a plain `Error`                        | `0` |

`timeout` and `aborted` both keep `status: 408` for backwards compatibility, so use `kind` to tell them apart:

```typescript
try {
  await GholaFetch.get('/api/data', { signal: controller.signal, timeout: 5000 });
} catch (error) {
  if (error instanceof GholaFetchError) {
    if (error.kind === 'aborted') return; // cancelled on purpose, nothing to report
    if (error.kind === 'timeout') showToast('The server is taking too long');
  }
}
```

When you throw a `GholaFetchError` yourself (e.g. from a `pre` middleware), you can pass the kind as the fourth constructor argument. If you don't, it defaults to `http` when `status >= 400` and to `unknown` otherwise.

## TypeScript Support

GholaFetch fully supports TypeScript, allowing you to specify the response data type:

```typescript
interface User {
  id: number;
  name: string;
  email: string;
}

// Specify the response data type
const getUser = async (id: number): Promise<User> => {
  const response = await GholaFetch.get<User>(`/users/${id}`);
  return response.data;
};

// With array responses
const getUsers = async (): Promise<User[]> => {
  const response = await GholaFetch.get<User[]>('/users');
  return response.data;
};
```

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

This project is licensed under the MIT License - see the LICENSE file for details.