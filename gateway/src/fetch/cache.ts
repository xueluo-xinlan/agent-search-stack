import { StringCache } from "../search/cache.js";

export type RenderMode = "direct" | "flaresolverr" | "playwright";

/** 规范化 URL 作缓存键：去 fragment + 跟踪参数 */
export function normalizeCacheUrl(url: string): string {
  try {
    const u = new URL(url);
    u.hash = "";
    for (const p of ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"]) {
      u.searchParams.delete(p);
    }
    return u.toString();
  } catch {
    return url;
  }
}

/**
 * fetch 结果缓存：按「URL + 渲染方式」分键隔离。
 * 不同渲染方式（direct/flaresolverr/playwright）结果不同，分开缓存避免污染。
 */
export class FetchCache {
  private caches: Record<RenderMode, StringCache>;

  constructor(maxEntries: number, ttlMs: number) {
    this.caches = {
      direct: new StringCache(maxEntries, ttlMs),
      flaresolverr: new StringCache(maxEntries, ttlMs),
      playwright: new StringCache(maxEntries, ttlMs),
    };
  }

  private key(url: string, maxChars?: number): string {
    return `${normalizeCacheUrl(url)}|chars:${maxChars ?? "default"}`;
  }

  get(mode: RenderMode, url: string, maxChars?: number): string | undefined {
    return this.caches[mode].get(this.key(url, maxChars));
  }

  set(mode: RenderMode, url: string, text: string, maxChars?: number): void {
    this.caches[mode].set(this.key(url, maxChars), text);
  }

  clear(): void {
    for (const c of Object.values(this.caches)) c.clear();
  }
}
