import { CacheOptions, ICache } from "./types";

export class InMemoryCache implements ICache {
  private cache: Map<string, { value: any; expiration: number }> = new Map();
  private maxCapacity: number;

  constructor(options: CacheOptions = {}) {
    this.maxCapacity = options.maxCapacity || Infinity;
  }

  get<T>(key: string): T | undefined {
    const entry = this.cache.get(key);
    if (!entry) {
      return undefined;
    }
    if (entry.expiration && entry.expiration < Date.now()) {
      this.cache.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set<T>(key: string, value: T, ttl: number): void {
    if (this.cache.size >= this.maxCapacity) {
      // Simple cache eviction policy (FIFO)
      const firstKey = this.cache.keys().next().value;
      if (firstKey) this.cache.delete(firstKey);
    }
    if (ttl !== undefined) {
      const expiration = Date.now() + ttl;
      this.cache.set(key, { value, expiration });
    }
  }

  remove(key: string): void {
    this.cache.delete(key);
  }

  clear(): void {
    this.cache.clear();
  }
}
