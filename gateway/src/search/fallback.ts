import domino from "@mixmark-io/domino";
import type { GatewayConfig } from "../config.js";
import type { Logger } from "../logger.js";
import type { SearchRequest, SearxngResponse, SearxngResult } from "./searxng.js";

/**
 * 备用直连搜索引擎：当上游 SearXNG 不可达或超时时自动兜底。
 * 优先级：Tavily API（若配置或设了环境变量 TAVILY_API_KEY） -> DuckDuckGo HTML 直连
 */
export async function searchFallback(
  req: SearchRequest,
  config: GatewayConfig,
  logger: Logger,
): Promise<SearxngResponse> {
  if (config.searchTavilyApiKey) {
    try {
      logger.info(`searxng 不可达，尝试 Tavily API 兜底检索: "${req.query}"`);
      const tavilyRes = await fetch("https://api.tavily.com/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          api_key: config.searchTavilyApiKey,
          query: req.query,
          max_results: 10,
          search_depth: "basic",
          include_answer: true,
        }),
        signal: AbortSignal.timeout(10000),
      });

      if (tavilyRes.ok) {
        const data = (await tavilyRes.json()) as {
          answer?: string;
          results?: Array<{ title?: string; url?: string; content?: string; score?: number }>;
        };
        const results: SearxngResult[] = (data.results ?? []).map((r) => ({
          title: r.title ?? "",
          url: r.url ?? "",
          content: r.content ?? "",
          engine: "tavily",
          score: r.score ?? 0.9,
        }));
        const answers = data.answer ? [{ answer: data.answer }] : [];
        return {
          query: req.query,
          results,
          answers,
          suggestions: [],
        };
      }
      logger.warn(`Tavily 兜底失败 (HTTP ${tavilyRes.status})，降级至 DuckDuckGo`);
    } catch (err) {
      logger.warn(`Tavily 兜底请求异常: ${String(err)}，降级至 DuckDuckGo`);
    }
  }

  logger.info(`searxng 不可达，尝试 DuckDuckGo HTML 直连兜底: "${req.query}"`);
  const ddgUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(req.query)}`;
  const res = await fetch(ddgUrl, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Accept-Language": req.language || "zh-CN,zh;q=0.9,en;q=0.8",
    },
    signal: AbortSignal.timeout(12000),
  });

  if (!res.ok) {
    throw new Error(`DuckDuckGo 直连失败 (HTTP ${res.status})`);
  }

  const html = await res.text();
  const doc = domino.createDocument(html);
  const nodes = Array.from(doc.querySelectorAll(".result"));
  const results: SearxngResult[] = [];

  for (const el of nodes) {
    const cls = el.getAttribute("class") || "";
    if (cls.includes("result--ad") || el.querySelector(".badge--ad")) continue;
    const titleEl = el.querySelector(".result__title .result__a");
    const snippetEl = el.querySelector(".result__snippet");
    if (!titleEl) continue;

    let link = titleEl.getAttribute("href") || "";
    if (link.includes("uddg=")) {
      try {
        const u = new URL(link, "https://duckduckgo.com");
        const real = u.searchParams.get("uddg");
        if (real) link = decodeURIComponent(real);
      } catch {}
    }
    if (link.startsWith("//")) link = "https:" + link;
    if (!link.startsWith("http")) continue;

    const title = titleEl.textContent?.trim() || "";
    const content = snippetEl?.textContent?.trim() || "";
    if (title && link) {
      results.push({
        title,
        url: link,
        content,
        engine: "duckduckgo",
        score: 0.85,
      });
    }
  }

  return {
    query: req.query,
    results,
    suggestions: [],
    answers: [],
  };
}
