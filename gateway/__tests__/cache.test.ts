import { describe, expect, it, vi } from "vitest";
import { StringCache } from "../src/search/cache.js";

describe("StringCache", () => {
  it("set 后可 get，未命中返回 undefined", () => {
    const c = new StringCache(10, 1000);
    expect(c.get("a")).toBeUndefined();
    c.set("a", "value");
    expect(c.get("a")).toBe("value");
  });

  it("TTL 过期后未命中", () => {
    vi.useFakeTimers();
    const c = new StringCache(10, 1000);
    c.set("a", "v", 100);
    expect(c.get("a")).toBe("v");
    vi.advanceTimersByTime(101);
    expect(c.get("a")).toBeUndefined();
    vi.useRealTimers();
  });

  it("LFU 淘汰最低频条目", () => {
    const c = new StringCache(2, 100000);
    c.set("a", "1");
    c.set("b", "2");
    c.get("a"); // a 频次 2
    c.set("c", "3"); // 超容量，淘汰最低频（b）
    expect(c.get("a")).toBe("1");
    expect(c.get("b")).toBeUndefined();
    expect(c.get("c")).toBe("3");
  });

  it("size/clear", () => {
    const c = new StringCache(10, 1000);
    c.set("a", "1");
    c.set("b", "2");
    expect(c.size()).toBe(2);
    c.clear();
    expect(c.size()).toBe(0);
  });
});
