import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import type { GatewayConfig } from "../src/config.js";
import type { Logger } from "../src/logger.js";
import { startHttpServer } from "../src/server.js";
import { createServer } from "../src/server.js";

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
    ...overrides,
  };
}

async function mcpRequest(base: string, body: unknown, opts: { token?: string; sessionId?: string } = {}) {
  const headers: Record<string, string> = { "Content-Type": "application/json", Accept: "application/json, text/event-stream" };
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  if (opts.sessionId) headers["Mcp-Session-Id"] = opts.sessionId;
  const res = await fetch(`${base}/mcp`, { method: "POST", headers, body: JSON.stringify(body) });
  return { status: res.status, headers: res.headers, text: await res.text() };
}

describe("MCP HTTP server", () => {
  let base = "";
  let closeFn: (() => Promise<void>) | undefined;

  beforeAll(async () => {
    const cfg = makeConfig();
    const http = await startHttpServer({ config: cfg, logger: silentLogger }, createServer);
    closeFn = http.close;
    const url = new URL(http.url);
    base = `http://127.0.0.1:${url.port}`;
  });

  afterAll(async () => {
    await closeFn?.();
  });

  it("无 token 时 initialize 握手成功并返回 serverInfo", async () => {
    const { status, text } = await mcpRequest(base, {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } },
    });
    expect(status).toBe(200);
    expect(text).toContain("agent-search-gateway");
    expect(text).toContain("tools");
  });

  it("initialize 后带 session 可调 tools/list", async () => {
    // initialize 拿 session id
    const init = await fetch(`${base}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "initialize",
        params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } },
      }),
    });
    const sessionId = init.headers.get("mcp-session-id");
    expect(sessionId).toBeTruthy();

    const { status, text } = await mcpRequest(base, { jsonrpc: "2.0", id: 3, method: "tools/list" }, { sessionId: sessionId! });
    expect(status).toBe(200);
    expect(text).toContain("health");
  });

  it("tools/call health 返回后端状态", async () => {
    const init = await fetch(`${base}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 4,
        method: "initialize",
        params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } },
      }),
    });
    const sessionId = init.headers.get("mcp-session-id")!;
    const { text } = await mcpRequest(
      base,
      { jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "health", arguments: {} } },
      { sessionId },
    );
    expect(text).toContain("searxng");
    expect(text).toContain("flaresolverr");
  });
});

describe("token 认证", () => {
  let base = "";
  let closeFn: (() => Promise<void>) | undefined;

  beforeAll(async () => {
    const cfg = makeConfig({ token: "secret-token" });
    const http = await startHttpServer({ config: cfg, logger: silentLogger }, createServer);
    closeFn = http.close;
    const url = new URL(http.url);
    base = `http://127.0.0.1:${url.port}`;
  });

  afterAll(async () => {
    await closeFn?.();
  });

  it("无 token 返回 401", async () => {
    const { status } = await mcpRequest(base, { jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
    expect(status).toBe(401);
  });

  it("错误 token 返回 401", async () => {
    const { status } = await mcpRequest(base, { jsonrpc: "2.0", id: 1, method: "initialize", params: {} }, { token: "wrong" });
    expect(status).toBe(401);
  });

  it("正确 token 通过认证", async () => {
    const { status } = await mcpRequest(
      base,
      { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } } },
      { token: "secret-token" },
    );
    expect(status).toBe(200);
  });
});
