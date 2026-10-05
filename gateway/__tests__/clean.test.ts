import { describe, expect, it } from "vitest";
import { cleanResults } from "../src/search/clean.js";

function r(overrides: Record<string, unknown> = {}) {
  return {
    url: "https://example.com/page",
    title: "Example Title",
    content: "Some content",
    engine: "ddg",
    engines: ["ddg"],
    ...overrides,
  };
}

describe("cleanResults", () => {
  it("过滤空 title/url 和非法协议", () => {
    const out = cleanResults(
      [
        r(),
        r({ title: "" }),
        r({ url: "" }),
        r({ url: "javascript:alert(1)" }),
      ],
      {},
    );
    expect(out.results).toHaveLength(1);
  });

  it("按规范化 URL 去重（剥 utm_*）", () => {
    const out = cleanResults(
      [
        r({ url: "https://example.com/a?utm_source=x" }),
        r({ url: "https://example.com/a" }),
        r({ url: "https://example.com/b" }),
      ],
      {},
    );
    expect(out.results).toHaveLength(2);
  });

  it("解码 HTML 实体并压缩空白、截断 content", () => {
    const out = cleanResults([r({ content: "a &amp; b   <script>x</script>" })], { maxResultChars: 5 });
    expect(out.results[0].content.startsWith("a & b")).toBe(true);
    expect(out.results[0].content.endsWith("…")).toBe(true);
    expect(out.results[0].content.length).toBeLessThanOrEqual(6);
  });

  it("min_score 过滤", () => {
    const out = cleanResults([r({ score: 0.8 }), r({ score: 0.3 })], { minScore: 0.5 });
    expect(out.results).toHaveLength(1);
    expect(out.results[0].score).toBe(0.8);
  });

  it("num_results 切片", () => {
    const items = Array.from({ length: 10 }, (_, i) => r({ url: `https://e.com/${i}` }));
    const out = cleanResults(items, { maxResults: 3 });
    expect(out.results).toHaveLength(3);
  });

  it("shouldBlock 丢弃命中黑名单域名", () => {
    const block = (h: string) => h.endsWith("spam.com");
    const out = cleanResults(
      [r({ url: "https://spam.com/x" }), r({ url: "https://good.com/y" })],
      { shouldBlock: block },
    );
    expect(out.results).toHaveLength(1);
    expect(out.results[0].url).toContain("good.com");
  });

  it("engines 合并：单引擎转数组", () => {
    const out = cleanResults([r({ engine: "google", engines: undefined })], {});
    expect(out.results[0].engines).toEqual(["google"]);
  });
});
