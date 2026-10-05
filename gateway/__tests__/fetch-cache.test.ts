import { describe, expect, it } from "vitest";
import { FetchCache, normalizeCacheUrl } from "../src/fetch/cache.js";

describe("normalizeCacheUrl", () => {
  it("去 fragment 和跟踪参数", () => {
    expect(normalizeCacheUrl("https://a.com/x?utm_source=x#sec")).toBe("https://a.com/x");
  });
});

describe("FetchCache", () => {
  it("按渲染方式隔离", () => {
    const c = new FetchCache(100, 600000);
    c.set("direct", "https://a.com/", "direct md");
    c.set("playwright", "https://a.com/", "playwright md");
    expect(c.get("direct", "https://a.com/")).toBe("direct md");
    expect(c.get("playwright", "https://a.com/")).toBe("playwright md");
  });

  it("maxChars 区分键", () => {
    const c = new FetchCache(100, 600000);
    c.set("direct", "https://a.com/", "default", undefined);
    c.set("direct", "https://a.com/", "short", 100);
    expect(c.get("direct", "https://a.com/")).toBe("default");
    expect(c.get("direct", "https://a.com/", 100)).toBe("short");
  });

  it("TTL 过期", () => {
    const c = new FetchCache(10, 100);
    c.set("direct", "https://a.com/", "x");
    expect(c.get("direct", "https://a.com/")).toBe("x");
    return new Promise((resolve) => setTimeout(() => {
      expect(c.get("direct", "https://a.com/")).toBeUndefined();
      resolve(null);
    }, 150));
  });
});
