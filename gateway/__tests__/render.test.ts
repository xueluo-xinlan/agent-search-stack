import { createServer as createHttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BrowserPool } from "../src/browser/pool.js";
import type { GatewayConfig } from "../src/config.js";
import { createFetchService } from "../src/fetch/service.js";
import type { Logger } from "../src/logger.js";

const silentLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  close: () => {},
} as Logger;

function makeConfig(overrides: Partial<GatewayConfig> = {}): GatewayConfig {
  return {
    host: "127.0.0.1",
    port: 0,
    token: undefined,
    logLevel: "info",
    logFile: undefined,
    searxngUrl: "http://127.0.0.1:1",
    searxngTimeoutMs: 3000,
    flaresolverrUrl: "http://127.0.0.1:1", // 指向不可达，触发 playwright 兜底
    flaresolverrEnabled: true,
    flaresolverrTimeoutMs: 2000,
    flaresolverrMaxConcurrent: 2,
    flaresolverrTriggerStatus: [403, 405, 429],
    flaresolverrFallbackOnEmpty: true,
    searchMaxResults: 10,
    searchMaxResultChars: 500,
    searchCacheTtlMs: 300000,
    searchCacheMaxEntries: 200,
    searchMaxConcurrent: 2,
    adFilterEnabled: false,
    adFilterLevel: "off",
    adFilterExtraDomains: [],
    adFilterHostsFile: "data/adblock/hosts",
    adFilterAllowlist: [],
    adFilterAutoUpdate: false,
    adFilterAutoUpdateIntervalMs: 86400000,
    fetchTimeoutMs: 3000,
    fetchMaxBytes: 65536,
    fetchUserAgent: "",
    fetchBlockPrivateIps: false,
    fetchStructural: "clean",
    fetchMaxOutputChars: 20000,
    fetchCacheTtlMs: 600000,
    fetchCacheMaxEntries: 200,
    browserEnabled: true,
    browserHeadless: true,
    browserPoolSize: 1,
    browserIdleTtlMs: 360000,
    browserTimeoutMs: 15000,
    browserMaxConcurrent: 2,
    browserEngine: "chromium",
    browserProxyServer: "",
    browserProxyUsername: "",
    browserProxyPassword: "",
    browserWaitForSelector: "",
    browserScreenshotEnabled: true,
    browserScreenshotMaxSize: 512,
    browserScreenshotImageType: "jpeg",
    ...overrides,
  };
}

let server: ReturnType<typeof createHttpServer>;
let base = "";

beforeAll(async () => {
  server = createHttpServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname === "/blocked403") {
      // 403 + 完整 HTML 正文：direct 因 403 失败，playwright 渲染能拿到 body
      res.writeHead(403, { "Content-Type": "text/html; charset=utf-8" });
      res.end("<html><head><title>SPA 渲染页</title></head><body><h1>渲染正文</h1><p>JS 动态内容</p></body></html>");
    } else {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end("<html><head><title>SPA 页</title></head><body><h1>渲染正文</h1><p>JS 动态内容</p></body></html>");
    }
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => {
  server.close();
});

describe("fetch 路由③ playwright 兜底", () => {
  it("403 → FlareSolverr 失败 → playwright 渲染成功", async () => {
    const pool = new BrowserPool(makeConfig(), silentLogger);
    try {
      const svc = createFetchService(makeConfig(), silentLogger, pool);
      const r = await svc.fetch({ url: `${base}/blocked403` });
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.text).toContain("渲染正文");
        expect(r.text).toContain("浏览器渲染");
      }
    } finally {
      await pool.closeAll();
    }
  });
});
