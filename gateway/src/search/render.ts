import type { SearxngInfobox, SearxngResponse } from "./searxng.js";
import type { CleanedResult } from "./clean.js";

export interface RenderInput {
  query: string;
  raw: SearxngResponse;
  results: CleanedResult[];
  latencyMs: number;
  skipped?: number; // 被广告过滤丢弃的数量
}

function engineLabel(engines: string[]): string {
  return engines.length > 0 ? ` · ${engines.join("/")}` : "";
}

function dateLabel(publishedDate?: string): string {
  if (!publishedDate) return "";
  try {
    const d = new Date(publishedDate);
    if (Number.isNaN(d.getTime())) return "";
    return ` · ${d.toISOString().slice(0, 10)}`;
  } catch {
    return "";
  }
}

function scoreLabel(score?: number): string {
  if (score === undefined) return "";
  return ` · score ${score.toFixed(2)}`;
}

function renderMetadata(data: SearxngResponse): string[] {
  const sections: string[] = [];

  const answers = data.answers ?? [];
  if (answers.length > 0) {
    sections.push("## 直接回答");
    for (const a of answers) {
      const text = typeof a === "string" ? a : a.answer ?? "";
      const line = text ? `- ${text}` : "";
      sections.push(line);
      if (typeof a === "object" && a !== null && a.url) {
        sections.push(`  - 来源: ${a.url}`);
      }
    }
  }

  const corrections = data.corrections ?? [];
  if (corrections.length > 0) {
    sections.push("## 拼写纠正");
    sections.push(...corrections.map((c) => `- 你是不是想搜「${c}」?`));
  }

  const suggestions = data.suggestions ?? [];
  if (suggestions.length > 0) {
    sections.push("## 建议");
    sections.push(...suggestions.map((s) => `- ${s}`));
  }

  const infoboxes: SearxngInfobox[] = data.infoboxes ?? [];
  if (infoboxes.length > 0) {
    for (const ib of infoboxes) {
      const lines: string[] = [];
      if (ib.infobox) lines.push(`## ${ib.infobox}`);
      if (ib.content) lines.push(ib.content);
      if (Array.isArray(ib.urls) && ib.urls.length > 0) {
        for (const u of ib.urls) {
          if (u.title && u.url) lines.push(`- [${u.title}](${u.url})`);
        }
      }
      sections.push(lines.join("\n"));
    }
  }

  return sections;
}

function renderResults(results: CleanedResult[]): string {
  if (results.length === 0) {
    return "*没有找到结果。*\n\n可以尝试：\n- 换更短或更宽泛的关键词\n- 去掉时间/语言过滤\n- 检查拼写";
  }
  return results
    .map((r, i) => {
      const head = `${i + 1}. [${r.title}](${r.url})${engineLabel(r.engines)}${dateLabel(r.publishedDate)}${scoreLabel(r.score)}`;
      const body = r.content ? `\n   ${r.content}` : "";
      return `${head}${body}`;
    })
    .join("\n\n");
}

function renderUnresponsive(data: SearxngResponse): string {
  const ue = data.unresponsive_engines ?? [];
  if (ue.length === 0) return "";
  const lines = ue.map(([name, reason]) => `- ${name}: ${reason}`);
  return `> 部分引擎暂不可用（${ue.length}）：\n${lines.join("\n")}`;
}

/**
 * 渲染为纯 md 文本（无 front matter）。
 * 结构：# 标题 → 元数据置顶 → ## 结果 → 引擎错误提示。
 */
export function renderSearchMarkdown(input: RenderInput): string {
  const { query, raw, results, latencyMs, skipped } = input;
  const lines: string[] = [];

  lines.push(`# Search: ${query}`);
  const metaParts = [`${results.length} 个结果`];
  if (skipped && skipped > 0) metaParts.push(`(已过滤 ${skipped} 条)`);
  metaParts.push(`${latencyMs}ms`);
  lines.push(`*${metaParts.join(" · ")}*`);
  lines.push("");

  lines.push(...renderMetadata(raw));
  if (raw.answers?.length || raw.corrections?.length || raw.suggestions?.length || raw.infoboxes?.length) {
    lines.push("");
  }

  lines.push("## 结果");
  lines.push("");
  lines.push(renderResults(results));

  const ue = renderUnresponsive(raw);
  if (ue) {
    lines.push("");
    lines.push(ue);
  }

  return lines.join("\n");
}
