// Small in-memory TTL cache used to avoid hammering the upstream tennis data API.
// Not durable across restarts -- that's fine, it's a rate-limiting aid, not a data store.

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

export class TtlCache {
  private store = new Map<string, CacheEntry<unknown>>();

  get<T>(key: string): T | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value as T;
  }

  set<T>(key: string, value: T, ttlMs: number): void {
    this.store.set(key, { value, expiresAt: Date.now() + ttlMs });
  }

  /**
   * `bypass: true` skips the cache read entirely (used by a user-initiated "refresh" action that
   * must actually pull fresh data instead of silently re-serving whatever is still within TTL),
   * but the freshly-fetched value is still written back to the cache under the same key/TTL so
   * subsequent normal (non-bypass) reads get the benefit of it.
   */
  async getOrFetch<T>(key: string, ttlMs: number, fetcher: () => Promise<T>, opts?: { bypass?: boolean }): Promise<T> {
    if (!opts?.bypass) {
      const cached = this.get<T>(key);
      if (cached !== undefined) return cached;
    }
    const value = await fetcher();
    this.set(key, value, ttlMs);
    return value;
  }
}
