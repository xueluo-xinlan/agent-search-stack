import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { isAdListStale } from "../src/filter/adlist.js";

const dirs: string[] = [];
function tempDir(): string {
  const d = mkdtempSync(join(tmpdir(), "adlist-test-"));
  dirs.push(d);
  return d;
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function makeConfig(hostsFile: string, intervalMs: number) {
  return {
    adFilterEnabled: true,
    adFilterLevel: "ads" as const,
    adFilterHostsFile: hostsFile,
    adFilterAutoUpdateIntervalMs: intervalMs,
    adFilterAutoUpdate: true,
    adFilterExtraDomains: [],
    adFilterAllowlist: [],
  };
}

describe("isAdListStale", () => {
  it("文件不存在 → stale", () => {
    expect(isAdListStale(makeConfig(join(tempDir(), "nohosts"), 86400000))).toBe(true);
  });

  it("文件存在且未过期 → 不 stale", () => {
    const d = tempDir();
    const f = join(d, "hosts");
    writeFileSync(f, "0.0.0.0 example.com\n", "utf-8");
    expect(isAdListStale(makeConfig(f, 86400000))).toBe(false);
  });

  it("文件存在但超过间隔 → stale", () => {
    const d = tempDir();
    const f = join(d, "hosts");
    writeFileSync(f, "0.0.0.0 example.com\n", "utf-8");
    // 用 -1ms 间隔强制视为过期
    expect(isAdListStale(makeConfig(f, -1))).toBe(true);
  });

  it("disabled → 不触发（由调用方判断，此处 stale 判定仍基于文件）", () => {
    const d = tempDir();
    expect(isAdListStale(makeConfig(join(d, "nohosts"), 86400000))).toBe(true);
  });
});
