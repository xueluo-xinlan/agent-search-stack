import { createServer as createHttpServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { Buffer } from "node:buffer";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { GatewayConfig } from "../src/config.js";
import { directFetch } from "../src/fetch/direct.js";

/**
 * GBK 编码的 HTML（header 不带 charset，只在 <meta> 声明）。
 * 内容：<html><head><meta charset="gbk"><title>中文</title></head>
 * <body><p>中文测试</p></body></html>
 * 由 python3 html.encode('gbk') 预生成。
 */
const GBK_HTML_HEX =
  "3c68746d6c3e3c686561643e3c6d65746120636861727365743d2267626b223e3c7469746c653ed6d0cec43c2f7469746c653e3c2f686561643e3c626f64793e3c703ed6d0cec4b2e2cad43c2f703e3c2f626f64793e3c2f68746d6c3e";

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
    fetchBlockPrivateIps: false, // mock 服务在 127.0.0.1
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

let server: ReturnType<typeof createHttpServer>;
let base = "";

beforeAll(async () => {
  server = createHttpServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname === "/html") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end("<html><head><title>T</title></head><body><p>你好</p></body></html>");
    } else if (url.pathname === "/redirect") {
      res.writeHead(302, { Location: "/html" });
      res.end();
    } else if (url.pathname === "/pdf") {
      res.writeHead(200, { "Content-Type": "application/pdf" });
      res.end("%PDF-1.4 fake");
    } else if (url.pathname === "/large") {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end("<html><body>" + "x".repeat(200000) + "</body></html>");
    } else if (url.pathname === "/error") {
      res.writeHead(500, { "Content-Type": "text/html" });
      res.end("<html>error</html>");
    } else if (url.pathname === "/gbk") {
      // header 不带 charset，只在 <meta> 声明 GBK（老中文站常见）
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(Buffer.from(GBK_HTML_HEX, "hex"));
    } else if (url.pathname === "/ua") {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(`<html><body>UA=${req.headers["user-agent"] ?? "none"}</body></html>`);
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => {
  server.close();
});

describe("directFetch", () => {
  it("抓取 HTML 成功（含中文）", async () => {
    const r = await directFetch(makeConfig(), `${base}/html`);
    expect(r.ok).toBe(true);
    expect(r.html).toContain("你好");
    expect(r.finalUrl).toBe(`${base}/html`);
  });

  it("header 无 charset 时用 <meta charset> 探测解码（GBK 老站）", async () => {
    const r = await directFetch(makeConfig(), `${base}/gbk`);
    expect(r.ok).toBe(true);
    expect(r.html).toContain("中文测试");
    expect(r.html).toContain("<title>中文</title>");
  });

  it("跟随重定向", async () => {
    const r = await directFetch(makeConfig(), `${base}/redirect`);
    expect(r.ok).toBe(true);
    expect(r.finalUrl).toBe(`${base}/html`);
  });

  it("非 HTML 内容返回 not_html", async () => {
    const r = await directFetch(makeConfig(), `${base}/pdf`);
    expect(r.ok).toBe(false);
    expect(r.errorKind).toBe("not_html");
  });

  it("HTTP 错误返回 http", async () => {
    const r = await directFetch(makeConfig(), `${base}/error`);
    expect(r.ok).toBe(false);
    expect(r.errorKind).toBe("http");
    expect(r.status).toBe(500);
  });

  it("超大响应截断并标记 truncated", async () => {
    const r = await directFetch(makeConfig(), `${base}/large`);
    expect(r.ok).toBe(true);
    expect(r.truncated).toBe(true);
    expect((r.html ?? "").length).toBeLessThanOrEqual(65536);
  });

  it("非法 URL 返回 invalid_url", async () => {
    const r = await directFetch(makeConfig(), "not a url");
    expect(r.ok).toBe(false);
    expect(r.errorKind).toBe("invalid_url");
  });

  it("非 http/https 协议拒绝", async () => {
    const r = await directFetch(makeConfig(), "file:///etc/passwd");
    expect(r.ok).toBe(false);
    expect(r.errorKind).toBe("invalid_url");
  });

  it("自定义 User-Agent 生效", async () => {
    const r = await directFetch(makeConfig({ fetchUserAgent: "CustomAgent/1.0" }), `${base}/ua`);
    expect(r.ok).toBe(true);
    expect(r.html).toContain("CustomAgent/1.0");
  });

  it("SSRF：block_private_ips=true 时拒绝内网 hostname", async () => {
    const cfg = makeConfig({ fetchBlockPrivateIps: true });
    const r = await directFetch(cfg, "http://localhost:1/");
    expect(r.ok).toBe(false);
    expect(r.errorKind).toBe("blocked_private_ip");
  });

  it("SSRF：重定向到内网地址被拒绝（绕过防护）", async () => {
    // 公网 URL → 302 → 内网 URL（如云 metadata），必须被拦截
    const cfg = makeConfig({ fetchBlockPrivateIps: true, fetchTimeoutMs: 2000 });
    const r = await directFetch(cfg, `${base}/redirect`);
    expect(r.ok).toBe(false);
    expect(r.errorKind).toBe("blocked_private_ip");
  });

  it("SSRF：重定向到非 http/https 协议被拒绝", async () => {
    // location: file:///etc/passwd —— 重定向目标协议也要校验
    const fileServer = createHttpServer((_req: IncomingMessage, res: ServerResponse) => {
      res.writeHead(302, { Location: "file:///etc/passwd" });
      res.end();
    });
    await new Promise<void>((r) => fileServer.listen(0, "127.0.0.1", r));
    const fileBase = `http://127.0.0.1:${(fileServer.address() as AddressInfo).port}`;
    try {
      const r = await directFetch(makeConfig(), `${fileBase}/x`);
      expect(r.ok).toBe(false);
      expect(r.errorKind).toBe("invalid_url");
    } finally {
      fileServer.close();
    }
  });
});
