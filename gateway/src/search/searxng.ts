export interface SearxngResult {
  url?: string;
  title?: string;
  content?: string;
  engine?: string;
  engines?: string[];
  category?: string;
  publishedDate?: string | null;
  score?: number;
  img_src?: string;
  thumbnail?: string;
  [key: string]: unknown;
}

export interface SearxngInfobox {
  infobox?: string;
  content?: string;
  urls?: Array<{ title?: string; url?: string }>;
  [key: string]: unknown;
}

export interface SearxngAnswer {
  answer: string;
  url?: string;
  template?: string;
  [key: string]: unknown;
}

export interface SearxngResponse {
  query?: string;
  results: SearxngResult[];
  answers?: SearxngAnswer[];
  corrections?: string[];
  suggestions?: string[];
  infoboxes?: SearxngInfobox[];
  unresponsive_engines?: Array<[string, string]>;
}

export interface SearchRequest {
  query: string;
  language?: string;
  timeRange?: string;
  safeSearch?: string;
  categories?: string;
  engines?: string;
  pageno?: number;
}

export interface SearchCallError {
  kind: "timeout" | "http" | "network" | "invalid_json";
  status?: number;
  message: string;
}

export type SearchCallResult =
  | { ok: true; data: SearxngResponse; latencyMs: number }
  | { ok: false; error: SearchCallError };

export function normalizeTimeRange(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return ["day", "week", "month", "year"].includes(value) ? value : undefined;
}

export function normalizeSafeSearch(value: string | undefined): string | undefined {
  if (!value) return undefined;
  return ["0", "1", "2"].includes(value) ? value : undefined;
}

export function normalizeLanguage(value: string | undefined): string | undefined {
  if (!value || value === "all" || value.trim() === "") return undefined;
  return value.trim();
}

/**
 * 调用 searxng JSON API。
 * 失败不抛裸异常，返回结构化错误（timeout/http/network/invalid_json）。
 */
export async function searchSearxng(
  baseUrl: string,
  timeoutMs: number,
  req: SearchRequest,
): Promise<SearchCallResult> {
  const params = new URLSearchParams();
  params.set("q", req.query);
  params.set("format", "json");
  if (req.pageno !== undefined && req.pageno > 1) params.set("pageno", String(req.pageno));

  const lang = normalizeLanguage(req.language);
  if (lang) params.set("language", lang);
  const tr = normalizeTimeRange(req.timeRange);
  if (tr) params.set("time_range", tr);
  const ss = normalizeSafeSearch(req.safeSearch);
  if (ss) params.set("safesearch", ss);
  if (req.categories) params.set("categories", req.categories);
  if (req.engines) params.set("engines", req.engines);

  const url = `${baseUrl}/search?${params.toString()}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const start = Date.now();

  try {
    const res = await fetch(url, { signal: controller.signal, redirect: "follow" });
    const latencyMs = Date.now() - start;
    if (!res.ok) {
      return { ok: false, error: { kind: "http", status: res.status, message: `searxng HTTP ${res.status}` } };
    }
    let data: SearxngResponse;
    try {
      data = (await res.json()) as SearxngResponse;
    } catch {
      return { ok: false, error: { kind: "invalid_json", message: "searxng 返回非 JSON" } };
    }
    if (!Array.isArray(data.results)) {
      data.results = [];
    }
    return { ok: true, data, latencyMs };
  } catch (err) {
    const latencyMs = Date.now() - start;
    const aborted = (err as Error)?.name === "AbortError";
    return {
      ok: false,
      error: aborted
        ? { kind: "timeout", message: `searxng 请求超时 (>${timeoutMs}ms)` }
        : { kind: "network", message: err instanceof Error ? err.message : String(err) },
    };
  } finally {
    clearTimeout(timer);
  }
}
