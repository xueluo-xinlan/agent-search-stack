# -*- coding: utf-8 -*-
"""端到端实测 PC 上的 FlareSolverr 兼容层：用被 Cloudflare 保护的站点验证真能过墙。"""
import json
import sys
import urllib.request

sys.stdout.reconfigure(encoding="utf-8", errors="replace")


def call(url, timeout=150):
    body = json.dumps({"cmd": "request.get", "url": url, "maxTimeout": 60000}).encode("utf-8")
    req = urllib.request.Request(
        "http://127.0.0.1:8191/v1",
        data=body,
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8", "ignore"))


TARGETS = [
    "https://nowsecure.nl/",          # Cloudflare 官方交互式挑战的经典测试站
]

for u in TARGETS:
    try:
        j = call(u)
        s = j.get("solution") or {}
        html = s.get("response") or ""
        print("%s -> status=%s http=%s bytes=%d solveTime=%s"
              % (u, j.get("status"), s.get("status"), len(html), s.get("solveTime")))
        if j.get("status") != "ok":
            print("   message:", j.get("message"))
        # 挑战是否真的解开：页面上不该再出现 Cloudflare 的挑战文案
        low = html.lower()
        marks = [m for m in ("just a moment", "cf-challenge", "checking your browser",
                             "enable javascript and cookies") if m in low]
        print("   挑战残留在页面上:", marks if marks else "无（已解开）")
    except Exception as e:
        print("%s -> EXCEPTION %s" % (u, e))
