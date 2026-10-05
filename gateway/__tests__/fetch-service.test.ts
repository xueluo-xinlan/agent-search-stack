import { createServer as createHttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
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
    browserTimeoutMs: 30000,
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

// ---- mock 目标站（direct 路径） ----
let targetServer: ReturnType<typeof createHttpServer>;
let targetBase = "";
// ---- mock FlareSolverr ----
let fsServer: ReturnType<typeof createHttpServer>;
let fsBase = "";
let fsCalled = 0;

beforeAll(async () => {
  targetServer = createHttpServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname === "/normal") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end("<html><head><title>普通页</title></head><body><article><h1>正文</h1><p>正常内容</p></article></body></html>");
    } else if (url.pathname === "/blocked403") {
      res.writeHead(403, { "Content-Type": "text/html", "cf-ray": "test123" });
      res.end("<html><body>Access denied by Cloudflare</body></html>");
    } else if (url.pathname === "/shell") {
      // 空壳 SPA
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end("<html><head><title>SPA</title></head><body><div id='app'></div><script src='/bundle.js'></script></body></html>");
    } else if (url.pathname === "/missing404") {
      res.writeHead(404, { "Content-Type": "text/html" });
      res.end("<html><body>not found</body></html>");
    } else {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end("<html><body>ok</body></html>");
    }
  });
  await new Promise<void>((r) => targetServer.listen(0, "127.0.0.1", r));
  targetBase = `http://127.0.0.1:${(targetServer.address() as AddressInfo).port}`;

  fsServer = createHttpServer((req, res) => {
    fsCalled++;
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          status: "ok",
          solution: {
            url: "https://rendered.example/",
            status: 200,
            response: "<html><head><title>渲染页</title></head><body><h1>渲染正文</h1><p>浏览器渲染内容</p></body></html>",
          },
        }),
      );
    });
  });
  await new Promise<void>((r) => fsServer.listen(0, "127.0.0.1", r));
  fsBase = `http://127.0.0.1:${(fsServer.address() as AddressInfo).port}`;
});

afterAll(() => {
  targetServer.close();
  fsServer.close();
});

describe("createFetchService 路由", () => {
  it("direct 成功：普通页正常返回 md", async () => {
    const svc = createFetchService(makeConfig(), silentLogger);
    const r = await svc.fetch({ url: `${targetBase}/normal` });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.text).toContain("普通页");
  });

  it("403 → 升级 FlareSolverr → 返回渲染 md", async () => {
    const cfg = makeConfig({ flaresolverrUrl: fsBase });
    const svc = createFetchService(cfg, silentLogger);
    const before = fsCalled;
    const r = await svc.fetch({ url: `${targetBase}/blocked403` });
    expect(r.ok).toBe(true);
    expect(fsCalled).toBe(before + 1);
    if (r.ok) {
      expect(r.text).toContain("渲染页");
      expect(r.text).toContain("浏览器渲染");
    }
  });

  it("空壳 JS → 升级 FlareSolverr", async () => {
    const cfg = makeConfig({ flaresolverrUrl: fsBase });
    const svc = createFetchService(cfg, silentLogger);
    const before = fsCalled;
    const r = await svc.fetch({ url: `${targetBase}/shell` });
    expect(r.ok).toBe(true);
    expect(fsCalled).toBe(before + 1);
  });

  it("404 → 不升级，返回 direct 错误", async () => {
    const cfg = makeConfig({ flaresolverrUrl: fsBase });
    const svc = createFetchService(cfg, silentLogger);
    const before = fsCalled;
    const r = await svc.fetch({ url: `${targetBase}/missing404` });
    expect(r.ok).toBe(false);
    expect(fsCalled).toBe(before); // 未调用 FlareSolverr
    expect(r.text).toContain("抓取失败");
  });

  it("flaresolverr.enabled=false → 403 不升级，返回 direct 错误", async () => {
    const cfg = makeConfig({ flaresolverrUrl: fsBase, flaresolverrEnabled: false });
    const svc = createFetchService(cfg, silentLogger);
    const before = fsCalled;
    const r = await svc.fetch({ url: `${targetBase}/blocked403` });
    expect(r.ok).toBe(false);
    expect(fsCalled).toBe(before);
  });

  it("FlareSolverr 失败 → 返回渲染失败错误", async () => {
    // FlareSolverr 指向不可达地址
    const cfg = makeConfig({ flaresolverrUrl: "http://127.0.0.1:1" });
    const svc = createFetchService(cfg, silentLogger);
    const r = await svc.fetch({ url: `${targetBase}/blocked403` });
    expect(r.ok).toBe(false);
    expect(r.text).toContain("浏览器渲染失败");
  });

  it("fetch 缓存：同一 URL 第二次命中（direct）", async () => {
    const svc = createFetchService(makeConfig(), silentLogger);
    const r1 = await svc.fetch({ url: `${targetBase}/normal` });
    expect(r1.ok).toBe(true);
    const r2 = await svc.fetch({ url: `${targetBase}/normal` });
    expect(r2.ok).toBe(true);
    if (r1.ok && r2.ok) expect(r2.text).toBe(r1.text);
  });

  it("错误码前缀：[FETCH_NOT_HTML]", async () => {
    const svc = createFetchService(makeConfig(), silentLogger);
    const r = await svc.fetch({ url: "http://127.0.0.1:1/whatever" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBeDefined();
      expect(r.text.startsWith("[")).toBe(true);
    }
  });
});
