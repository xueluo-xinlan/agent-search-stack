import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createServer as createHttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import type { GatewayConfig } from "../src/config.js";
import { getHealth } from "../src/health.js";

const MOCK = {
  up: createHttpServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end("<html><body>ok</body></html>");
  }),
  down: createHttpServer((_req, res) => {
    res.destroy(); // 模拟不可达
  }),
};

let upPort = 0;
let downPort = 0;

beforeAll(async () => {
  await new Promise<void>((r) => MOCK.up.listen(0, "127.0.0.1", r));
  await new Promise<void>((r) => MOCK.down.listen(0, "127.0.0.1", r));
  upPort = (MOCK.up.address() as AddressInfo).port;
  downPort = (MOCK.down.address() as AddressInfo).port;
});

afterAll(async () => {
  MOCK.up.close();
  MOCK.down.close();
});

function makeConfig(searxngPort: number, fsPort: number): GatewayConfig {
  return {
    host: "127.0.0.1",
    port: 0,
    token: undefined,
    logLevel: "info",
    logFile: undefined,
    searxngUrl: `http://127.0.0.1:${searxngPort}`,
    searxngTimeoutMs: 3000,
    flaresolverrUrl: `http://127.0.0.1:${fsPort}`,
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
  };
}

describe("getHealth", () => {
  it("两后端均 up 时报告 up", async () => {
    const h = await getHealth(makeConfig(upPort, upPort), Date.now());
    expect(h.searxng.status).toBe("up");
    expect(h.flaresolverr.status).toBe("up");
    expect(h.gateway.uptimeSec).toBeGreaterThanOrEqual(0);
  });

  it("后端不可达时报告 down 且带错误信息", async () => {
    const h = await getHealth(makeConfig(downPort, downPort), Date.now());
    expect(h.searxng.status).toBe("down");
    expect(h.flaresolverr.status).toBe("down");
    expect(h.searxng.error).toBeTruthy();
  });

  it("混合情况分别报告", async () => {
    const h = await getHealth(makeConfig(upPort, downPort), Date.now());
    expect(h.searxng.status).toBe("up");
    expect(h.flaresolverr.status).toBe("down");
  });
});
