import { describe, expect, it } from "vitest";
import {
  buildDomainFilter,
  isBlocked,
  parseHosts,
} from "../src/filter/domain-filter.js";

describe("parseHosts", () => {
  it("解析 hosts 行（跳过注释/空行）", () => {
    const text = [
      "# comment",
      "",
      "0.0.0.0 ads.example.com",
      "127.0.0.1 tracker.net",
      "::1 ipv6.example.org",
      "0.0.0.0 no-dot",
    ].join("\n");
    const set = parseHosts(text);
    expect(set.has("ads.example.com")).toBe(true);
    expect(set.has("tracker.net")).toBe(true);
    expect(set.has("ipv6.example.org")).toBe(true);
    expect(set.has("no-dot")).toBe(false); // 无点域名忽略
  });
});

describe("isBlocked", () => {
  const blocked = new Set(["ads.example.com", "spam.net"]);
  const allowlist = new Set(["good.example.com"]);

  it("精确命中", () => {
    expect(isBlocked("ads.example.com", blocked, allowlist)).toBe(true);
  });

  it("子域命中（a.b.ads.example.com 命中 ads.example.com）", () => {
    expect(isBlocked("sub.ads.example.com", blocked, allowlist)).toBe(true);
    expect(isBlocked("x.y.spam.net", blocked, allowlist)).toBe(true);
  });

  it("未命中返回 false", () => {
    expect(isBlocked("example.com", blocked, allowlist)).toBe(false);
    expect(isBlocked("notspam.net", blocked, allowlist)).toBe(false);
  });

  it("allowlist 优先：命中黑名单但白名单覆盖时不屏蔽", () => {
    blocked.add("good.example.com");
    expect(isBlocked("good.example.com", blocked, allowlist)).toBe(false);
    // 子域也遵循 allowlist 前缀？子域 good.example.com 的子域… 白名单只精确匹配
    expect(isBlocked("good.example.com", blocked, allowlist)).toBe(false);
  });
});

describe("buildDomainFilter", () => {
  it("off 或 disabled 时不加载", () => {
    const f = buildDomainFilter(false, "ads", [], "data/adblock/hosts", []);
    expect(f.enabled).toBe(false);
    expect(f.count).toBe(0);
  });
});
