#!/usr/bin/env python3
"""SearXNG 检测式看门狗 —— 只在引擎真的被停用时才重启。

为什么需要它
------------
SearXNG 的引擎被拦后会被「关小黑屋」：
    google  CAPTCHA        → 停用 3600 秒
    brave   请求过多(429)   → 停用 120 秒（失败累积还会升级）
而这些停用状态存在【内存】里（本实例 valkey: false，未接 Redis），
所以重启服务即可立刻解除 —— 但盲目定时重启多数时候清的是没坏的引擎，白重启。

本脚本的原则（与用户的监控哲学一致）
------------------------------------
1. 确定性判据：只看 SearXNG 自报的 unresponsive_engines 字段，不做抽样估算。
2. 只在必要时动手：全部正常 → 什么都不做。
3. 探针自身失败（网络异常/解析失败）【绝不】触发重启 —— 只认「明确被停用」信号。
4. 冷却保护：两次重启至少间隔 COOLDOWN_SECONDS，防止永久失效引擎导致重启循环。
5. 重启后复验，把「是否真的恢复」写进日志 —— 不做无验证的动作。

退出码
------
0 = 一切正常（含「已按需重启并恢复」）
1 = 探针异常（无法判断；不重启）
仅 0/1，便于 systemd 判读。
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import subprocess
import sys
import urllib.parse

SEARX_URL = "http://127.0.0.1:8890/search"
PROBE_QUERY = "linux kernel"
# 只盯 google，不盯 brave —— 这是实测得出的结论（2026-09-18）：
#   google 被 CAPTCHA 后是【本地】停用状态，重启即清，且恢复后能连打 12 次查询不复发 ✔
#   brave 的 429 是【对方服务器端】限流，重启只清本地记录、清不掉对方限流，
#         实测重启后复验立刻又是 429 → 盯它只会白白重启（它自己几分钟后会恢复）
WATCHED = {"google"}
COOLDOWN_SECONDS = 3600                # 两次重启最短间隔（对齐 google 的停用时长）

LOG_PATH = "/var/log/searxng-watchdog.log"
STATE_DIR = "/var/lib/searxng-watchdog"
STATE_PATH = os.path.join(STATE_DIR, "state.json")
PROBE_TIMEOUT = 40
RESTART_TIMEOUT = 60


def log(msg: str) -> None:
    stamp = dt.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    line = f"{stamp} {msg}"
    print(line)
    try:
        os.makedirs(os.path.dirname(LOG_PATH), exist_ok=True)
        with open(LOG_PATH, "a", encoding="utf-8") as fh:
            fh.write(line + "\n")
    except OSError as exc:                      # 日志写不进去不该让任务失败
        print(f"  (日志写入失败: {exc})", file=sys.stderr)


def probe() -> tuple[dict[str, str], str | None]:
    """返回 ({引擎: 停用原因}, 错误信息)。错误信息非空时不可据此判断。"""
    url = f"{SEARX_URL}?q={urllib.parse.quote(PROBE_QUERY)}&format=json"
    try:
        out = subprocess.run(
            ["curl", "-s", "--max-time", str(PROBE_TIMEOUT), url],
            capture_output=True, text=True, timeout=PROBE_TIMEOUT + 10,
        ).stdout
    except (subprocess.TimeoutExpired, OSError) as exc:
        return {}, f"探针请求失败: {type(exc).__name__}: {exc}"
    if not out.strip():
        return {}, "探针返回空响应（服务是否在跑？）"
    try:
        data = json.loads(out)
    except json.JSONDecodeError as exc:
        return {}, f"探针响应不是 JSON: {exc}"
    if not isinstance(data, dict):
        return {}, f"探针响应结构异常: {type(data).__name__}"

    down: dict[str, str] = {}
    for item in data.get("unresponsive_engines") or []:
        if isinstance(item, (list, tuple)) and len(item) >= 2:
            name, reason = str(item[0]), str(item[1])
            if name in WATCHED:
                down[name] = reason
    results = data.get("results") or []
    if not results and not down:
        return {}, "查询零结果且无停用记录（判据不明，不动作）"
    return down, None


def read_last_restart() -> float | None:
    try:
        with open(STATE_PATH, encoding="utf-8") as fh:
            return float(json.load(fh).get("last_restart_ts") or 0) or None
    except (OSError, ValueError, TypeError):
        return None


def write_last_restart(ts: float) -> None:
    try:
        os.makedirs(STATE_DIR, exist_ok=True)
        with open(STATE_PATH, "w", encoding="utf-8") as fh:
            json.dump({"last_restart_ts": ts,
                       "last_restart_human": dt.datetime.fromtimestamp(ts).strftime("%Y-%m-%d %H:%M:%S")},
                      fh, ensure_ascii=False, indent=2)
    except OSError as exc:
        log(f"  (状态写入失败: {exc})")


def restart_searxng() -> bool:
    try:
        proc = subprocess.run(["systemctl", "restart", "searxng"],
                              capture_output=True, text=True, timeout=RESTART_TIMEOUT)
    except (subprocess.TimeoutExpired, OSError) as exc:
        log(f"重启失败: {type(exc).__name__}: {exc}")
        return False
    if proc.returncode != 0:
        log(f"重启失败 (rc={proc.returncode}): {(proc.stderr or '').strip()[:200]}")
        return False
    return True


def main() -> int:
    ap = argparse.ArgumentParser(description="SearXNG 检测式看门狗")
    ap.add_argument("--dry-run", action="store_true", help="只报告将要做什么，不重启")
    ap.add_argument("--status", action="store_true", help="只打印当前探测结果")
    ap.add_argument("--ignore-cooldown", action="store_true", help="忽略冷却（仅在手动排障时用）")
    args = ap.parse_args()

    down, err = probe()

    if args.status:
        print(f"  被停用的盯防引擎: {down or '无'}")
        print(f"  探针错误: {err or '无'}")
        return 0

    if err:
        # 探针本身出问题 —— 不动作，交给下一次
        log(f"探针异常，不动作：{err}")
        return 1

    if not down:
        log("全部盯防引擎正常，无需动作")
        return 0

    detail = "; ".join(f"{k}={v}" for k, v in down.items())
    last = read_last_restart()
    now = dt.datetime.now().timestamp()

    if last and not args.ignore_cooldown:
        elapsed = now - last
        if elapsed < COOLDOWN_SECONDS:
            remaining = int(COOLDOWN_SECONDS - elapsed)
            log(f"检出停用（{detail}）但在冷却期内（已过 {int(elapsed)}s，还需 {remaining}s），不重启")
            return 0

    log(f"检出停用：{detail} → 重启 SearXNG")
    if args.dry_run:
        log("--dry-run：未实际重启")
        return 0

    if not restart_searxng():
        return 1
    write_last_restart(now)

    # 复验：重启到底有没有用，必须写下来
    import time
    time.sleep(5)
    down2, err2 = probe()
    if err2:
        log(f"重启后复验失败（探针异常）：{err2}")
        return 1
    if down2:
        log(f"重启后仍有停用：{'; '.join(f'{k}={v}' for k, v in down2.items())} —— 未完全恢复，等下次")
        return 0
    log("重启后复验通过：所有盯防引擎均已恢复")
    return 0


if __name__ == "__main__":
    sys.exit(main())
