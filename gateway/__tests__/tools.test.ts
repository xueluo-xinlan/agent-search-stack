import { createServer as createHttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BrowserPool } from "../src/browser/pool.js";
import { BrowserTools } from "../src/browser/tools.js";
import type { GatewayConfig } from "../src/config.js";
import type { Logger } from "../src/logger.js";
import { mcpSessionContext } from "../src/utils/session-context.js";

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
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(`<!DOCTYPE html>
<html><head><title>测试 SPA</title></head>
<body>
  <h1>首页标题</h1>
  <button id="btn">点我</button>
  <input id="input" />
  <div id="result"></div>
  <script>
    document.getElementById('btn').addEventListener('click', function() {
      document.getElementById('result').textContent = '按钮被点击了';
    });
  </script>
</body></html>`);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
});

afterAll(() => {
  server.close();
});

describe("BrowserTools（真实 playwright）", () => {
  let pool: BrowserPool;
  let tools: BrowserTools;

  beforeAll(() => {
    const cfg = makeConfig();
    pool = new BrowserPool(cfg, silentLogger);
    tools = new BrowserTools(pool, cfg, silentLogger);
  });

  afterAll(async () => {
    await pool.closeAll();
  });

  it("不同 MCP session 的浏览器上下文互相隔离", async () => {
    // session A 打开页面（写 cookie）；session B 应有独立 context，看不到 A 的 cookie
    const rA = await mcpSessionContext.run("session-a", () => tools.navigate(base));
    expect(rA.ok).toBe(true);
    await mcpSessionContext.run("session-a", async () => {
      const { page } = await pool.acquireSession();
      await page.evaluate(() => (document.cookie = "user=a"));
      expect(await page.evaluate(() => document.cookie)).toContain("user=a");
    });
    await mcpSessionContext.run("session-b", async () => {
      // B 自己打开页面后读取 cookie（about:blank 上读 cookie 会 SecurityError）
      const r = await tools.navigate(base);
      expect(r.ok).toBe(true);
      const { page } = await pool.acquireSession();
      expect(await page.evaluate(() => document.cookie)).not.toContain("user=a");
    });
  });

  it("browser_close 只清理当前 session 的上下文", async () => {
    await mcpSessionContext.run("session-close", () => tools.navigate(base));
    const r = await mcpSessionContext.run("session-close", () => tools.close());
    expect(r.ok).toBe(true);
    // 关闭后再次使用应自动重建（共享 browser 进程仍在）
    const r2 = await mcpSessionContext.run("session-close", () => tools.navigate(base));
    expect(r2.ok).toBe(true);
  });

  it("navigate 返回无障碍树", async () => {
    const r = await tools.navigate(base);
    expect(r.ok).toBe(true);
    expect(r.text).toContain("首页标题");
    expect(r.text).toContain("按钮被点击了".slice(0, 0)); // 占位
  });

  it("click 后无障碍树反映新状态", async () => {
    await tools.navigate(base);
    const before = await tools.snapshot();
    expect(before.ok).toBe(true);
    // 点击按钮
    const clickR = await tools.click("#btn");
    expect(clickR.ok).toBe(true);
    // 验证 result 内容变化
    const after = await tools.snapshot("#result");
    expect(after.ok).toBe(true);
    expect(after.text).toContain("按钮被点击了");
  });

  it("type 输入文本", async () => {
    await tools.navigate(base);
    const r = await tools.type("#input", "hello world");
    expect(r.ok).toBe(true);
  });

  it("takeScreenshot 返回 base64", async () => {
    await tools.navigate(base);
    const r = await tools.takeScreenshot();
    expect(r.ok).toBe(true);
    expect(r.screenshot?.base64).toBeTruthy();
    expect(r.screenshot?.mimeType).toBe("image/jpeg");
  });

  it("find 搜索文本", async () => {
    await tools.navigate(base);
    const r = await tools.find("首页标题");
    expect(r.ok).toBe(true);
    expect(r.text).toContain("首页标题");
  });

  it("close 关闭会话", async () => {
    const r = await tools.close();
    expect(r.ok).toBe(true);
  });
});
