import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

const dirs: string[] = [];

function tempDir(): string {
  const d = mkdtempSync(join(tmpdir(), "gw-test-"));
  dirs.push(d);
  return d;
}

function writeYaml(dir: string, content: string): string {
  const p = join(dir, "gateway.yaml");
  writeFileSync(p, content);
  return p;
}

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("loadConfig (gateway.yaml)", () => {
  it("文件不存在时抛错", () => {
    expect(() => loadConfig(join(tempDir(), "nonexist.yaml"))).toThrow(/配置文件不存在/);
  });

  it("空/非法 yaml 抛错", () => {
    const d = tempDir();
    writeYaml(d, "");
    expect(() => loadConfig(join(d, "gateway.yaml"))).toThrow();
  });

  it("使用默认值当配置省略", () => {
    const d = tempDir();
    const p = writeYaml(d, "gateway:\n  host: 127.0.0.1\n");
    const c = loadConfig(p);
    expect(c.host).toBe("127.0.0.1");
    expect(c.port).toBe(3000);
    expect(c.token).toBeUndefined();
    expect(c.searxngUrl).toBe("http://127.0.0.1:8888");
    expect(c.flaresolverrUrl).toBe("http://127.0.0.1:8192");
    expect(c.searchMaxResults).toBe(10);
    expect(c.adFilterLevel).toBe("ads");
    expect(c.adFilterEnabled).toBe(true);
  });

  it("读取完整配置", () => {
    const d = tempDir();
    const p = writeYaml(
      d,
      `
gateway:
  host: 0.0.0.0
  port: 4000
searxng:
  url: http://localhost:9999/
  timeout_ms: 5000
search:
  max_results: 20
  max_result_chars: 300
ad_filter:
  level: full
  extra_domains: ["spam.com"]
  allowlist: ["good.com"]
`,
    );
    const c = loadConfig(p);
    expect(c.host).toBe("0.0.0.0");
    expect(c.port).toBe(4000);
    expect(c.searxngUrl).toBe("http://localhost:9999"); // 去尾斜杠
    expect(c.searxngTimeoutMs).toBe(5000);
    expect(c.searchMaxResults).toBe(20);
    expect(c.searchMaxResultChars).toBe(300);
    expect(c.adFilterLevel).toBe("full");
    expect(c.adFilterExtraDomains).toEqual(["spam.com"]);
    expect(c.adFilterAllowlist).toEqual(["good.com"]);
  });

  it("env GATEWAY_TOKEN 覆盖 yaml token", () => {
    const d = tempDir();
    const p = writeYaml(d, "gateway:\n  token: yaml-token\n");
    const old = process.env.GATEWAY_TOKEN;
    process.env.GATEWAY_TOKEN = "env-token";
    try {
      expect(loadConfig(p).token).toBe("env-token");
    } finally {
      if (old === undefined) delete process.env.GATEWAY_TOKEN;
      else process.env.GATEWAY_TOKEN = old;
    }
  });

  it("空 token 视为未设置", () => {
    const d = tempDir();
    const p = writeYaml(d, "gateway:\n  token: \"\"\n");
    expect(loadConfig(p).token).toBeUndefined();
  });

  it("非法配置抛错", () => {
    const d = tempDir();
    const p = writeYaml(d, "gateway:\n  port: 99999\n");
    expect(() => loadConfig(p)).toThrow(/校验失败/);
  });

  it("非法 level 抛错", () => {
    const d = tempDir();
    const p = writeYaml(d, "ad_filter:\n  level: extreme\n");
    expect(() => loadConfig(p)).toThrow(/校验失败/);
  });
});
