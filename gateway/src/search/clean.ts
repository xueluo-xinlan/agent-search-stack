import type { SearxngResult } from "./searxng.js";

export interface CleanOptions {
  maxResults?: number;
  maxResultChars?: number;
  minScore?: number;
  /** 域名过滤器：(hostname) => boolean，返回 true 表示"丢弃" */
  shouldBlock?: (hostname: string) => boolean;
}

export interface CleanedResult {
  title: string;
  url: string;
  content: string;
  engines: string[];
  publishedDate?: string;
  score?: number;
  category?: string;
}

/** 规范化 URL 用于去重：去 fragment，去掉常见跟踪参数。 */
function normalizeUrlKey(url: string): string {
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

function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

function hostnameOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function truncate(s: string, max: number): string {
  if (max <= 0 || s.length <= max) return s;
  return s.slice(0, max) + "…";
}

/**
 * 文件型垃圾检测：sitemap/数据接口 XML/办公数据文件等非人类阅读页面。
 * 搜索引擎（尤其 google cse）常把这些塞进结果里，对一般查询都没用。
 * 刻意不挡 PDF/.doc/.ppt——论文、文档、演示在不少场景里是有价值结果。
 */
const FILE_JUNK_EXT = new Set([".xml", ".xlsx", ".xls", ".csv"]);
function isFileJunkUrl(u: URL): boolean {
  const path = u.pathname.toLowerCase();
  if (path.includes("sitemap")) return true;
  const m = path.match(/\.([a-z0-9]{2,6})$/);
  if (m && FILE_JUNK_EXT.has(m[0])) return true;
  return false;
}

export interface CleanResult {
  results: CleanedResult[];
  /** 因广告/垃圾域名过滤丢弃的数量（不含切片/去重） */
  blockedCount: number;
}

/**
 * 清洗链：
 *   过滤空字段/非法 URL → 域名黑名单（shouldBlock）→ 去重 → HTML 实体 → 截断
 *   → min_score 过滤 → num_results 切片。
 */
export function cleanResults(results: SearxngResult[], opts: CleanOptions): CleanResult {
  const seen = new Set<string>();
  const out: CleanedResult[] = [];
  let blockedCount = 0;

  for (const r of results) {
    const url = r.url ?? "";
    const title = (r.title ?? "").trim();
    if (!url || !title) continue;

    let u: URL;
    let host: string | null;
    try {
      u = new URL(url);
      if (u.protocol !== "http:" && u.protocol !== "https:") continue;
      host = u.hostname.toLowerCase();
    } catch {
      continue;
    }

    if (opts.shouldBlock && opts.shouldBlock(host)) {
      blockedCount += 1;
      continue;
    }

    if (isFileJunkUrl(u)) {
      blockedCount += 1;
      continue;
    }

    const key = normalizeUrlKey(url);
    if (seen.has(key)) continue;
    seen.add(key);

    const engines = Array.isArray(r.engines)
      ? r.engines
      : r.engine
        ? [r.engine]
        : [];

    out.push({
      title: decodeHtmlEntities(title),
      url,
      content: truncate(decodeHtmlEntities(r.content ?? "").replace(/\s+/g, " ").trim(), opts.maxResultChars ?? 500),
      engines,
      publishedDate: r.publishedDate ?? undefined,
      score: r.score,
      category: r.category,
    });
  }

  let filtered = out;
  if (opts.minScore !== undefined) {
    filtered = filtered.filter((r) => (r.score ?? 0) >= (opts.minScore ?? 0));
  }
  if (opts.maxResults !== undefined && opts.maxResults > 0) {
    filtered = filtered.slice(0, opts.maxResults);
  }
  return { results: filtered, blockedCount };
}
