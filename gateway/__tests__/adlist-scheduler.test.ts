import { describe, expect, it, vi, afterEach } from "vitest";
import { startAdListScheduler } from "../src/filter/adlist.js";
import type { Logger } from "../src/logger.js";

const silentLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  close: () => {},
} as Logger;

function makeConfig(overrides: Record<string, unknown> = {}) {
  return {
    adFilterEnabled: true,
    adFilterLevel: "ads" as const,
    adFilterHostsFile: overrides.hostsFile as string ?? "/tmp/nonexist-hosts-test",
    adFilterAutoUpdate: true,
    adFilterAutoUpdateIntervalMs: overrides.intervalMs as number ?? 1000,
    adFilterExtraDomains: [],
    adFilterAllowlist: [],
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("startAdListScheduler", () => {
  it("disabled 时返回空操作函数", () => {
    const stop = startAdListScheduler(
      { ...makeConfig(), adFilterEnabled: false } as never,
      silentLogger,
      () => {},
    );
    expect(stop).toBeTypeOf("function");
  });

  it("off level 时不启动", () => {
    const stop = startAdListScheduler(
      { ...makeConfig(), adFilterLevel: "off" } as never,
      silentLogger,
      () => {},
    );
    expect(stop).toBeTypeOf("function");
  });

  it("周期触发：hosts 缺失 → 拉取 → onRefresh 回调", async () => {
    vi.useFakeTimers();
    // mock fetch 返回假 hosts
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      text: async () => "0.0.0.0 spam.example.com\n",
    })));

    let refreshCount = 0;
    const stop = startAdListScheduler(makeConfig({ intervalMs: 100 }) as never, silentLogger, () => {
      refreshCount++;
    });

    // 推进时间触发定时器
    await vi.advanceTimersByTimeAsync(300);
    expect(refreshCount).toBeGreaterThan(0);

    // stop 后不再触发
    stop();
    const after = refreshCount;
    await vi.advanceTimersByTimeAsync(500);
    expect(refreshCount).toBe(after);
  });

  it("拉取失败不回调", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false })));

    let refreshCount = 0;
    const stop = startAdListScheduler(makeConfig({ intervalMs: 100 }) as never, silentLogger, () => {
      refreshCount++;
    });

    await vi.advanceTimersByTimeAsync(300);
    expect(refreshCount).toBe(0);
    stop();
  });
});
