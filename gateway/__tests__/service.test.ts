import { createServer as createHttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { GatewayConfig } from "../src/config.js";
import type { DomainFilter } from "../src/filter/domain-filter.js";
import type { Logger } from "../src/logger.js";
import { createSearchService } from "../src/search/service.js";

const silentLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  close: () => {},
} as Logger;

// mock searxng：返回固定 JSON，记录收到的 query
let mockServer: ReturnType<typeof createHttpServer>;
let searxngPort = 0;
let lastQuery = "";

beforeAll(async () => {
  mockServer = createHttpServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    lastQuery = url.searchParams.get("q") ?? "";
    const body = {
      query: url.searchParams.get("q") ?? "",
      results: [
        { url: "https://good.com/a", title: "Good A", content: "content a", engine: "ddg", score: 0.9 },
        { url: "https://spam.com/x", title: "Spam X", content: "content x", engine: "ddg", score: 0.5 },
        { url: "https://good.com/b", title: "Good B", content: "content b", engine: "google", score: 0.7 },
        { url: "https://good.com/b?utm_source=x", title: "Good B dup", content: "content b dup", engine: "google", score: 0.6 },
      ],
      answers: ["direct answer here"],
      corrections: [],
      suggestions: ["sug1"],
      infoboxes: [],
      unresponsive_engines: [["brave", "too many requests"]],
    };
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(body));
  });
  await new Promise<void>((r) => mockServer.listen(0, "127.0.0.1", r));
  searxngPort = (mockServer.address() as AddressInfo).port;
});

afterAll(() => {
  mockServer.close();
});

function makeConfig(overrides: Partial<GatewayConfig> = {}): GatewayConfig {
  return {
    host: "127.0.0.1",
    port: 0,
    token: undefined,
    logLevel: "info",
    logFile: undefined,
    searxngUrl: `http://127.0.0.1:${searxngPort}`,
    searxngTimeoutMs: 3000,
    flaresolverrUrl: "http://127.0.0.1:1",
    flaresolverrEnabled: true,
    flaresolverrTimeoutMs: 5000,
    flaresolverrMaxConcurrent: 2,
    flaresolverrTriggerStatus: [403, 405, 429],
    flaresolverrFallbackOnEmpty: true,
    searchMaxResults: 10,
    searchMaxResultChars: 500,
    searchCacheTtlMs: 300000,
    searchCacheMaxEntries: 200,
    searchMaxConcurrent: 2,
    adFilterEnabled: true,
    adFilterLevel: "ads",
    adFilterExtraDomains: [],
    adFilterHostsFile: "data/adblock/hosts",
    adFilterAllowlist: [],
    adFilterAutoUpdate: false,
    adFilterAutoUpdateIntervalMs: 86400000,
    ...overrides,
  };
}

// 广告过滤：block spam.com
const domainFilter: DomainFilter = {
  enabled: true,
  blocked: new Set(["spam.com"]),
  allowlist: new Set(),
  count: 1,
};

describe("createSearchService", () => {
  it("全链路：调 searxng + 广告过滤 + 去重 + md 渲染", async () => {
    const svc = createSearchService(makeConfig(), domainFilter, silentLogger);
    const r = await svc.search({ query: "test query" });
    expect(r.ok).toBe(true);
    const text = r.text;

    // 请求构造
    expect(lastQuery).toBe("test query");

    // 广告过滤：spam.com 被过滤
    expect(text).not.toContain("Spam X");
    // 去重：utm 变体合并（保留第一个 Good B，丢弃 Good B dup）
    expect(text).toContain("Good A");
    expect(text).toContain("Good B");
    expect(text).not.toContain("Good B dup");
    // 元数据置顶
    expect(text).toContain("direct answer here");
    expect(text).toContain("sug1");
    // unresponsive 提示
    expect(text).toContain("brave");
  });

  it("缓存：第二次命中", async () => {
    const svc = createSearchService(makeConfig(), domainFilter, silentLogger);
    const r1 = await svc.search({ query: "cached query" });
    const r2 = await svc.search({ query: "cached query" });
    expect(r1.ok && r1.cacheHit).toBe(false);
    expect(r2.ok && r2.cacheHit).toBe(true);
    expect(r1.ok && r2.ok && r1.text === r2.text).toBe(true);
  });

  it("不同参数不同缓存键", async () => {
    const svc = createSearchService(makeConfig(), domainFilter, silentLogger);
    await svc.search({ query: "k1" });
    await svc.search({ query: "k1", numResults: 5 });
    const r2 = await svc.search({ query: "k1" });
    expect(r2.ok && r2.cacheHit).toBe(true);
  });

  it("searxng 失败返回结构化错误文本而非崩溃", async () => {
    // 指向一个不存在的端口
    const cfg = makeConfig({ searxngUrl: "http://127.0.0.1:1" });
    const svc = createSearchService(cfg, domainFilter, silentLogger);
    const r = await svc.search({ query: "x" });
    expect(r.ok).toBe(false);
    expect(r.text).toContain("搜索失败");
  });
});
