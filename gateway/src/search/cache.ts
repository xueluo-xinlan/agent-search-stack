interface CacheEntry {
  value: string;
  expiresAt: number;
  freq: number;
}

/**
 * 简单 TTL + LFU 缓存。存字符串（搜索结果 md 文本）。
 * 键由调用方构造（稳定字符串）。
 */
export class StringCache {
  private map = new Map<string, CacheEntry>();
  private maxEntries: number;
  private defaultTtlMs: number;

  constructor(maxEntries: number, defaultTtlMs: number) {
    this.maxEntries = maxEntries;
    this.defaultTtlMs = defaultTtlMs;
  }

  get(key: string): string | undefined {
    const entry = this.map.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.map.delete(key);
      return undefined;
    }
    entry.freq += 1;
    return entry.value;
  }

  set(key: string, value: string, ttlMs?: number): void {
    const ttl = ttlMs ?? this.defaultTtlMs;
    if (this.map.size >= this.maxEntries) {
      this.evict();
    }
    this.map.set(key, { value, expiresAt: Date.now() + ttl, freq: 1 });
  }

  has(key: string): boolean {
    return this.get(key) !== undefined;
  }

  size(): number {
    return this.map.size;
  }

  clear(): void {
    this.map.clear();
  }

  /** 淘汰 LFU 最低（freq 最小）的条目；全部到期则先清过期。 */
  private evict(): void {
    const now = Date.now();
    for (const [k, v] of this.map) {
      if (now > v.expiresAt) {
        this.map.delete(k);
      }
    }
    if (this.map.size < this.maxEntries) return;

    let minKey: string | undefined;
    let minFreq = Infinity;
    for (const [k, v] of this.map) {
      if (v.freq < minFreq) {
        minFreq = v.freq;
        minKey = k;
      }
    }
    if (minKey !== undefined) {
      this.map.delete(minKey);
    }
  }
}
