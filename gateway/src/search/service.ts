import type { GatewayConfig } from "../config.js";
import type { DomainFilter } from "../filter/domain-filter.js";
import { isBlocked } from "../filter/domain-filter.js";
import type { Logger } from "../logger.js";
import { ErrorCodes, withCode } from "../utils/errors.js";
import { Semaphore } from "../utils/semaphore.js";
import { StringCache } from "./cache.js";
import { cleanResults } from "./clean.js";
import { searchFallback } from "./fallback.js";
import { renderSearchMarkdown } from "./render.js";
import { rerankResults } from "./rerank.js";
import { searchSearxng, type SearchRequest } from "./searxng.js";

export interface SearchParams {
  query: string;
  language?: string;
  timeRange?: string;
  safeSearch?: string;
  categories?: string;
  engines?: string;
  minScore?: number;
  numResults?: number;
}

export interface SearchOutcome {
  ok: boolean;
  code?: (typeof ErrorCodes)[keyof typeof ErrorCodes];
  text: string;
  cacheHit?: boolean;
}

export interface SearchService {
  search(params: SearchParams): Promise<SearchOutcome>;
}

/** 构造稳定缓存键（与搜索参数一致）。 */
function cacheKey(params: SearchParams): string {
  return JSON.stringify([
    params.query,
    params.language ?? "",
    params.timeRange ?? "",
    params.safeSearch ?? "",
    params.categories ?? "",
    params.engines ?? "",
    params.minScore ?? "",
    params.numResults ?? "",
  ]);
}

export function createSearchService(
  config: GatewayConfig,
  domainFilter: DomainFilter,
  logger: Logger,
): SearchService {
  const cache = new StringCache(config.searchCacheMaxEntries, config.searchCacheTtlMs);
  const sem = new Semaphore(config.searchMaxConcurrent);

  async function search(params: SearchParams): Promise<SearchOutcome> {
    const key = cacheKey(params);
    const cached = cache.get(key);
    if (cached !== undefined) {
      logger.debug(`search cache hit: "${params.query}"`);
      return { ok: true, text: cached, cacheHit: true };
    }

    const release = await sem.acquire();
    try {
      const req: SearchRequest = {
        query: params.query,
        language: params.language,
        timeRange: params.timeRange,
        safeSearch: params.safeSearch,
        categories: params.categories,
        engines: params.engines,
      };

      const result = await searchSearxng(config.searxngUrl, config.searxngTimeoutMs, req);
      let searchData = result.ok ? result.data : null;
      let latency = result.ok ? result.latencyMs : 0;
      let usedFallback = false;

      if (!result.ok) {
        if (config.searchFallback) {
          try {
            const startFallback = Date.now();
            searchData = await searchFallback(req, config, logger);
            latency = Date.now() - startFallback;
            usedFallback = true;
          } catch (fallbackErr) {
            logger.warn(`直连兜底检索亦失败: ${String(fallbackErr)}`);
          }
        }

        if (!searchData) {
          const e = result.error;
          let code: SearchOutcome["code"] = ErrorCodes.SEARCH_UPSTREAM;
          if (e.kind === "timeout") code = ErrorCodes.SEARCH_TIMEOUT;
          else if (e.kind === "invalid_json") code = ErrorCodes.SEARCH_INVALID;
          const text = `搜索失败（${e.kind}${e.status ? ` ${e.status}` : ""}）：${e.message}\n\n请稍后重试，或更换关键词。`;
          return { ok: false, code, text: withCode(code, text) };
        }
      }

      if (!searchData) {
        return { ok: false, code: ErrorCodes.SEARCH_UPSTREAM, text: "搜索失败" };
      }

      const data = searchData;
      const latencyMs = latency;
      const rawCount = data.results.length;

      // 轻量重排：绕过 searxng category 分组排序，按 score × boost 降序
      const reranked = rerankResults(data.results, {
        enabled: config.rerankEnabled,
        engineBoost: config.rerankEngineBoost,
      });

      const { results: cleaned, blockedCount } = cleanResults(reranked, {
        maxResults: params.numResults ?? config.searchMaxResults,
        maxResultChars: config.searchMaxResultChars,
        minScore: params.minScore,
        shouldBlock: domainFilter.enabled
          ? (host) => isBlocked(host, domainFilter.blocked, domainFilter.allowlist)
          : undefined,
      });

      let text = renderSearchMarkdown({
        query: params.query,
        raw: data,
        results: cleaned,
        latencyMs,
        skipped: blockedCount > 0 ? blockedCount : undefined,
      });

      if (usedFallback) {
        text = `> ℹ️ 上游 SearXNG 未就绪，已自动通过直连搜索引擎获取最新结果。\n\n` + text;
      }

      cache.set(key, text);
      logger.debug(`search done: "${params.query}" (${cleaned.length}/${rawCount} results, ${blockedCount} blocked)`);
      return { ok: true, text, cacheHit: false };
    } finally {
      release();
    }
  }

  return { search };
}
