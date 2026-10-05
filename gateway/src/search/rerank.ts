import type { SearxngResult } from "./searxng.js";

export interface RerankConfig {
  enabled: boolean;
  engineBoost: Record<string, number>;
}

/**
 * 轻量重排层。
 *
 * 背景：searxng 的 get_ordered_results() 在按 score 排序后还会做一次
 * category/template 分组（results.py pass 2），同组结果前插到组首，
 * 导致带缩略图的视频类结果（如 bilibili 的 videos.html）被百科类结果
 * 整体挤到后面——即使它的 score 更高也进不了前 N。
 *
 * 这里绕过 searxng 的返回顺序，按「引擎原始 score × boost」降序重排，
 * 让被埋的高分结果正常入场。boost 在 gateway.yaml 的 rerank.engine_boost
 * 里按 searxng 注册名（JSON 的 engine 字段）配置，默认 1.0；
 * enabled: false 时完全保持 searxng 原始顺序，行为不变。
 */
export function rerankResults(results: SearxngResult[], cfg: RerankConfig): SearxngResult[] {
  if (!cfg.enabled || results.length < 2) return results;

  const boostFor = (r: SearxngResult): number => {
    const engs = r.engines && r.engines.length > 0 ? r.engines : r.engine ? [r.engine] : [];
    let b = 1.0;
    for (const e of engs) b *= cfg.engineBoost[e] ?? 1.0;
    return b;
  };

  return [...results].sort((a, b) => {
    const sa = (a.score ?? 0) * boostFor(a);
    const sb = (b.score ?? 0) * boostFor(b);
    return sb - sa;
  });
}
