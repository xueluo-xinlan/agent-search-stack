#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""刷新 SearXNG 成人/低质域名移除清单（hostnames 插件用）。

原理：
  1. 拉取 StevenBlack hosts 的 unified（广告/跟踪）与 porn（unified + porn 扩展）两个列表；
  2. 做差集得到「纯成人扩展域名」；
  3. 加上一批安全词根正则（覆盖长尾镜像站），落成 YAML 列表；
  4. 写入 /etc/searxng/hostnames-remove.yml 并重启 searxng。

用法：searxng-hostnames-refresh.py [--no-restart]
"""
from __future__ import annotations

import os
import re
import subprocess
import sys
import urllib.request

import yaml

WORK = "/root/.hermes/cache/scratch/searxng-refresh"
OUT = "/etc/searxng/hostnames-remove.yml"
PORN_URL = "https://raw.githubusercontent.com/StevenBlack/hosts/master/alternates/porn/hosts"
UNI_URL = "https://raw.githubusercontent.com/StevenBlack/hosts/master/hosts"

# 裸子串词根：含这些片段的域名几乎不可能是正经站点，直接子串匹配
SEEDS_FILE = "/etc/searxng/hostnames-seeds.json"   # 域名种子外置：脚本正文不自带域名，读脚本不会污染会话


def _load_seeds() -> dict:
    import json
    with open(SEEDS_FILE, encoding="utf-8") as fh:
        return json.load(fh)


_SEEDS = _load_seeds()
ROOTS = _SEEDS["roots"]   # 裸子串词根（外置）
BOUND = _SEEDS["bound"]   # 需边界匹配的词根（外置）


def fetch(url: str, path: str) -> None:
    req = urllib.request.Request(url, headers={"User-Agent": "hermes-searxng-filter/1.0"})
    with urllib.request.urlopen(req, timeout=120) as resp:
        data = resp.read()
    with open(path, "wb") as fh:
        fh.write(data)


def load_domains(path: str) -> set[str]:
    out: set[str] = set()
    rx = re.compile(r"^\S+\s+([\w.-]+)")
    for line in open(path, encoding="utf-8", errors="ignore"):
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        m = rx.match(line)
        if not m:
            continue
        d = m.group(1).lower()
        if not re.match(r"^[a-z0-9.-]+\.[a-z]{2,}$", d):
            continue
        out.add(d[4:] if d.startswith("www.") else d)
    return out


def main() -> int:
    os.makedirs(WORK, exist_ok=True)
    porn_path = os.path.join(WORK, "porn.hosts")
    uni_path = os.path.join(WORK, "uni.hosts")
    fetch(PORN_URL, porn_path)
    fetch(UNI_URL, uni_path)

    porn = load_domains(porn_path)
    uni = load_domains(uni_path)
    only = sorted(porn - uni)
    if len(only) < 1000:
        print(f"[warn] 差集过小（{len(only)}），可能抓取异常，放弃覆盖", file=sys.stderr)
        return 2

    pats: set[str] = set()
    for r in ROOTS:
        pats.add(r)
    for b in BOUND:
        pats.add(r"(^|[.-])" + re.escape(b) + r"([.-]|$)")
    for d in only:
        pats.add(re.escape(d))

    ordered = sorted(pats)
    header = (
        "# SearXNG 成人/低质域名移除清单（自动生成，勿手改）\n"
        "# 来源：StevenBlack hosts porn 扩展差集 + 安全词根模式\n"
        "# 重建：searxng-hostnames-refresh.py（改后需 systemctl restart searxng）\n"
    )
    with open(OUT, "w", encoding="utf-8") as fh:
        fh.write(header)
        yaml.safe_dump(ordered, fh, allow_unicode=True, default_flow_style=False, width=1000)

    print(f"OK: 规则 {len(ordered)} 条 → {OUT}（{os.path.getsize(OUT)} bytes），porn-only 域名 {len(only)}")

    if "--no-restart" not in sys.argv:
        subprocess.run(["systemctl", "restart", "searxng"], check=False)
        print("searxng 已重启")

    # 同步到 PC 侧 SearXNG（best-effort：PC 离线/隧道断只告警，不影响本机）
    if "--no-pc" not in sys.argv:
        ssh_common = [
            "-o", "ControlPath=/run/pc-link.sock",
            "-o", "BatchMode=yes",
            "-o", "ConnectTimeout=10",
            "-o", "StrictHostKeyChecking=no",
            "-i", "/root/.ssh/id_ed25519",
        ]
        try:
            subprocess.run(
                ["scp", *ssh_common, "-P", "2222", OUT,
                 "user@127.0.0.1:C:/Users/you/Projects/searxng/searx/hostnames-remove.yml"],
                check=True, timeout=180,
            )
            subprocess.run(
                ["ssh", *ssh_common, "-p", "2222", "user@127.0.0.1",
                 "powershell -ExecutionPolicy Bypass -File C:\\Users\\you\\restart_searxng.ps1"],
                check=True, timeout=240, capture_output=True,
            )
            print("PC 侧清单已同步并重启 SearXNG")
        except Exception as exc:  # noqa: BLE001 - 同步失败不应中断本机刷新
            print(f"[warn] PC 同步失败（本机已生效）：{exc}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
