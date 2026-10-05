import { createDocument, type DominoDocument, type DominoElement } from "@mixmark-io/domino";
import TurndownService from "turndown";

/** 清理模式：移除的元素选择器 */
const CLEAN_SELECTORS = [
  "script",
  "style",
  "noscript",
  "nav",
  "footer",
  "aside",
  "form",
  "iframe",
  "[class*='advert']",
  "[class*='ad-']",
  "[class*='ads']",
  "[id*='advert']",
  "[id*='ad-']",
  "[id*='ads']",
  "[class*='cookie']",
  "[id*='cookie']",
  "[class*='social-share']",
  "[class*='share-']",
  "[class*='related']",
  "[class*='recommend']",
  "[class*='sidebar']",
  "[class*='menu']",
  "[class*='breadcrumb']",
  "[class*='pagination']",
];

function absoluteUrl(href: string, base: string): string {
  try {
    return new URL(href, base).toString();
  } catch {
    return href;
  }
}

/** 遍历 domino 的 NodeList（不可迭代，需索引访问） */
function each(list: { length: number }, fn: (el: DominoElement, i: number) => void): void {
  for (let i = 0; i < list.length; i++) {
    const el = (list as unknown as { [k: number]: DominoElement })[i];
    if (el) fn(el, i);
  }
}

/** 把相对 URL（href/src）转为绝对 URL，基于 baseUrl。 */
function absolutizeUrls(doc: DominoDocument, baseUrl: string): void {
  each(doc.querySelectorAll("[href]"), (el) => {
    const v = el.getAttribute("href");
    if (v) el.setAttribute("href", absoluteUrl(v, baseUrl));
  });
  each(doc.querySelectorAll("[src]"), (el) => {
    const v = el.getAttribute("src");
    if (v) el.setAttribute("src", absoluteUrl(v, baseUrl));
  });
}

function collapseBlankLines(s: string): string {
  return s
    .split("\n")
    .map((l) => l.trimEnd())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export interface HtmlToMdOptions {
  /** clean(去导航/广告) | full(保留完整结构) */
  structural: "clean" | "full";
  baseUrl: string;
  maxOutputChars: number;
}

export interface HtmlToMdResult {
  markdown: string;
  title: string | undefined;
}

/**
 * HTML → markdown。
 * - domino 解析 DOM
 * - structural=clean 时移除导航/广告等噪音元素
 * - 相对 URL 转绝对
 * - turndown 转换（atx 标题、fenced 代码块）
 * - 压缩空白 + 截断到 maxOutputChars
 */
export function htmlToMarkdown(html: string, opts: HtmlToMdOptions): HtmlToMdResult {
  const doc = createDocument(html);

  const title = doc.querySelector("title")?.textContent?.trim() || undefined;

  // title 由调用方作为标题使用，避免在正文里重复渲染
  const titleEl = doc.querySelector("title");
  if (titleEl) titleEl.remove();

  if (opts.structural === "clean") {
    for (const sel of CLEAN_SELECTORS) {
      each(doc.querySelectorAll(sel), (el) => el.remove());
    }
  }

  absolutizeUrls(doc, opts.baseUrl);

  const td = new TurndownService({
    headingStyle: "atx",
    codeBlockStyle: "fenced",
    bulletListMarker: "-",
  });

  let markdown = td.turndown(doc as unknown as Parameters<TurndownService["turndown"]>[0]);
  markdown = collapseBlankLines(markdown);

  if (markdown.length > opts.maxOutputChars) {
    markdown = markdown.slice(0, opts.maxOutputChars) + "\n\n…(内容已截断)";
  }

  return { markdown, title };
}
