export interface ICache {
  get<T>(key: string): T | undefined;
  set<T>(key: string, value: T, ttl: number): void;
  remove(key: string): void;
  clear(): void;
}

export type CacheOptions = {
  maxCapacity?: number;
};
