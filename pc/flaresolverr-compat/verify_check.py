#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""登录态验证：等常驻兼容层起来，再抓两个最能说明问题的页面。

为什么选这两个目标：
  · 京东商品页 —— 价格字段受登录墙保护，登录前是占位符 "4??"，
    登录后才会出现真实数字。它是最灵敏的"登录是否生效"探针。
  · 淘宝商品页 —— 未登录必被 302 到 login.taobao.com；登录后应落回商品页。

只打印结论（状态码/字节数/墙标记/落点），绝不打印正文，避免污染上下文。
用法： python verify_check.py
"""
import json
import sys
import time
import urllib.request

try:
    # 同 verify_cookies.py：不强制 gbk，避免 Windows Terminal / 65001 下乱码
    sys.stdout.reconfigure(errors="replace")
except Exception:
    pass

ENDPOINT = "http://127.0.0.1:8191/v1"

TARGETS = [
    # 京东：移动商品页，价格字段受登录墙保护（未登录是占位符 "4??"）
    ("京东商品页", "https://item.m.jd.com/product/44807734636.html",
     ("登录查看价格", "4??")),
    # 淘宝：搜索页 —— 未登录必被甩到 login.taobao.com，登录后返回结果页。
    # 不再用固定商品 ID：ID 会下架，落 error.item.taobao.com/error/noitem，
    # 与登录墙无关却会被误判（2026-10-05 实测踩过）。
    ("淘宝搜索页", "https://s.taobao.com/search?q=%E6%89%8B%E5%8A%9E%E6%9F%9C",
     ("login.taobao.com", "havanaone", "login.m.taobao.com")),
]


def wait_ready(limit_s: int = 150) -> bool:
    """等服务 browserReady（看护脚本只看端口会漏判，必须看这个字段）。"""
    t0 = time.time()
    while time.time() - t0 < limit_s:
        try:
            with urllib.request.urlopen("http://127.0.0.1:8191/health", timeout=8) as r:
                d = json.loads(r.read().decode("utf-8", "replace"))
            if d.get("browserReady"):
                print("  服务就绪：version=%s（等了 %ds）"
                      % (d.get("version"), int(time.time() - t0)))
                return True
        except Exception:
            pass
        time.sleep(5)
    print("  警告：等待 %ds 后仍未就绪" % limit_s)
    return False


def call(url: str):
    body = json.dumps({"cmd": "request.get", "url": url, "maxTimeout": 90000}).encode("utf-8")
    req = urllib.request.Request(ENDPOINT, data=body,
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=150) as r:
        return json.loads(r.read().decode("utf-8", "replace"))


def main() -> int:
    print("[验证] 等待常驻兼容层就绪 ……")
    wait_ready()
    print("-" * 62)
    for label, url, hints in TARGETS:
        try:
            d = call(url)
            s = d.get("solution") or {}
            b = s.get("response") or ""
            hit = [h for h in hints if h in b]
            print("  %-10s status=%-6s bytes=%-8d 墙标记=%s"
                  % (label, d.get("status"), len(b), ("、".join(hit) if hit else "无")))
            print("  %-10s 落点=%s" % ("", (s.get("url") or "")[:110]))
            if s.get("suspectedWall"):
                print("  %-10s suspectedWall=%s" % ("", s["suspectedWall"]))
        except Exception as e:
            print("  %-10s ERROR %s" % (label, str(e)[:100]))
    print("-" * 62)
    print("  判读：墙标记=\u65e0 说明该站的登录态已生效；仍有标记则登录未生效或已过期。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
