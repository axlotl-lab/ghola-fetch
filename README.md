# GholaFetch

A modern, flexible and powerful HTTP client for browser and Node.js environments, built on top of the Fetch API. Named after the "Ghola" concept from Frank Herbert's Dune series, this library recreates and enhances the native fetch functionality with additional features.

[![npm version](https://img.shields.io/npm/v/@axlotl-lab/ghola-fetch.svg)](https://www.npmjs.com/package/@axlotl-lab/ghola-fetch)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## Features

- Built on the native Fetch API
- Supports both instance and static usage patterns (like Axios)
- Powerful middleware system for request/response transformation
- Automatic content type detection and parsing
- Integrated caching with Cache-Control support
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
  pre: async (options) => {
    console.log(`Request to: ${options.baseUrl || ''}${options.endpoint}`);
    return options;
  },
  post: async (response) => {
    console.log(`Response status: ${response.status}`);
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