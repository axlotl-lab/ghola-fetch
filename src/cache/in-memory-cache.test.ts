import { InMemoryCache } from './in-memory-cache';

describe('InMemoryCache', () => {
  test('should respect maxCapacity and evict oldest entries', () => {
    const maxCapacity = 3;
    const memoryCache = new InMemoryCache({ maxCapacity });

    memoryCache.set('key1', 'value1', 1000);
    memoryCache.set('key2', 'value2', 1000);
    memoryCache.set('key3', 'value3', 1000);

    expect(memoryCache.get('key1')).toEqual('value1');
    expect(memoryCache.get('key2')).toEqual('value2');
    expect(memoryCache.get('key3')).toEqual('value3');

    memoryCache.set('key4', 'value4', 1000);

    expect(memoryCache.get('key1')).toBeUndefined();
    expect(memoryCache.get('key2')).toEqual('value2');
    expect(memoryCache.get('key3')).toEqual('value3');
    expect(memoryCache.get('key4')).toEqual('value4');
  });
});