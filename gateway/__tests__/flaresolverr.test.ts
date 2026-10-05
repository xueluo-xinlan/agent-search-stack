import { createServer as createHttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { GatewayConfig } from "../src/config.js";
import { createFlareSolverrClient } from "../src/fetch/flaresolverr.js";

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

interface MockBehavior {
  status: "ok" | "error";
  response?: string;
  message?: string;
  returnOnlyCookies?: boolean;
}

let server: ReturnType<typeof createHttpServer>;
let base = "";
let receivedBody: unknown = null;

beforeAll(async () => {
  server = createHttpServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      receivedBody = JSON.parse(Buffer.concat(chunks).toString("utf-8"));
      const behavior = (server as unknown as { behavior?: MockBehavior }).behavior ?? { status: "ok", response: "<html><body>rendered</body></html>" };
      if (behavior.status === "ok") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            status: "ok",
            solution: {
              url: "https://target.example/",
              status: 200,
              response: behavior.returnOnlyCookies ? undefined : (behavior.response ?? "<html><body>rendered</body></html>"),
              cookies: [{ name: "cf_clearance", value: "abc" }],
              userAgent: "Mozilla/5.0",
            },
          }),
        );
      } else {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ status: "error", message: behavior.message ?? "failed" }));
      }
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => {
  server.close();
});

function setBehavior(b: MockBehavior): void {
  (server as unknown as { behavior: MockBehavior }).behavior = b;
}

describe("createFlareSolverrClient", () => {
  it("请求体：request.get + returnOnlyCookies=false", async () => {
    const cfg = makeConfig({ flaresolverrUrl: base });
    const client = createFlareSolverrClient(cfg);
    setBehavior({ status: "ok", response: "<html><body>r</body></html>" });
    await client.requestGet("https://target.example/");
    expect(receivedBody).toMatchObject({
      cmd: "request.get",
      url: "https://target.example/",
      returnOnlyCookies: false,
    });
  });

  it("成功返回渲染 HTML", async () => {
    const cfg = makeConfig({ flaresolverrUrl: base });
    const client = createFlareSolverrClient(cfg);
    setBehavior({ status: "ok", response: "<html><body>RENDERED</body></html>" });
    const r = await client.requestGet("https://target.example/");
    expect(r.ok).toBe(true);
    expect(r.renderedHtml).toContain("RENDERED");
    expect(r.finalUrl).toBe("https://target.example/");
  });

  it("error 状态返回 not_ok", async () => {
    const cfg = makeConfig({ flaresolverrUrl: base });
    const client = createFlareSolverrClient(cfg);
    setBehavior({ status: "error", message: "challenge failed" });
    const r = await client.requestGet("https://target.example/");
    expect(r.ok).toBe(false);
    expect(r.errorKind).toBe("not_ok");
  });

  it("FlareSolverr 不可达返回 network", async () => {
    const cfg = makeConfig({ flaresolverrUrl: "http://127.0.0.1:1" });
    const client = createFlareSolverrClient(cfg);
    const r = await client.requestGet("https://target.example/");
    expect(r.ok).toBe(false);
    expect(r.errorKind).toBe("network");
  });

  it("SSRF：内网 URL 被拦截（不发请求到 FlareSolverr）", async () => {
    const cfg = makeConfig({ flaresolverrUrl: base, fetchBlockPrivateIps: true });
    const client = createFlareSolverrClient(cfg);
    const r = await client.requestGet("http://169.254.169.254/latest/meta-data/");
    expect(r.ok).toBe(false);
    expect(r.errorKind).toBe("blocked");
  });

  it("SSRF：非 http/https 协议被拦截", async () => {
    const cfg = makeConfig({ flaresolverrUrl: base, fetchBlockPrivateIps: true });
    const client = createFlareSolverrClient(cfg);
    const r = await client.requestGet("file:///etc/passwd");
    expect(r.ok).toBe(false);
    expect(r.errorKind).toBe("blocked");
  });

  it("fetchBlockPrivateIps=false 时内网 URL 放行（仅协议检查）", async () => {
    const cfg = makeConfig({ flaresolverrUrl: base, fetchBlockPrivateIps: false });
    const client = createFlareSolverrClient(cfg);
    setBehavior({ status: "ok", response: "<html><body>ok</body></html>" });
    const r = await client.requestGet("http://127.0.0.1:8080/");
    expect(r.ok).toBe(true);
  });
});
