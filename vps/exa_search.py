#!/usr/bin/env python3
"""Exa / Parallel 无密钥检索器（keyless ring，免注册、免费）。

用途：SearXNG（bing 元搜索）只给「标题+短摘要」，命中不足或需要正文级证据时，
走本脚本拿「正文片段（highlights/excerpts）」，一轮即可得到可引用内容。

用法:
    python3 ~/exa_search.py "查询词" [条数] [exa|parallel]
示例:
    python3 ~/exa_search.py "SearXNG braveapi engine config" 3 exa
    python3 ~/exa_search.py "2026 GPU 推荐" 5 parallel

退出码: 0 有结果 / 1 无结果 / 2 调用失败
"""
from __future__ import annotations

import json
import sys
import urllib.request

EXA_URL = "https://mcp.exa.ai/mcp"
PARALLEL_URL = "https://search.parallel.ai/mcp"
TIMEOUT = 45
HDRS = {
    "Content-Type": "application/json",
    "Accept": "application/json, text/event-stream",
    # urllib 默认 UA 会被 mcp.exa.ai / search.parallel.ai 的 Cloudflare 判为机器人直接 403
    "User-Agent": "hermes-agent/1.0",
}


def _post(url: str, payload: dict) -> dict:
    req = urllib.request.Request(url, data=json.dumps(payload).encode(), headers=HDRS, method="POST")
    with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
        raw = resp.read().decode("utf-8", "replace")
    # 两个端点都返回 SSE（`event: message` + `data: {...}`）或裸 JSON
    for line in raw.splitlines():
        line = line.strip()
        if line.startswith("data:"):
            return json.loads(line[5:].strip())
    return json.loads(raw)


def exa(query: str, n: int) -> int:
    data = _post(EXA_URL, {
        "jsonrpc": "2.0", "id": 1, "method": "tools/call",
        "params": {"name": "web_search_exa",
                   "arguments": {"query": query, "numResults": n}},
    })
    content = data.get("result", {}).get("content") or []
    text = "\n".join(c.get("text", "") for c in content if c.get("type") == "text")
    print(text.strip() or "(空)")
    return 0 if text.strip() else 1


def parallel(query: str, n: int) -> int:
    data = _post(PARALLEL_URL, {
        "jsonrpc": "2.0", "id": 1, "method": "tools/call",
        "params": {"name": "web_search",
                   "arguments": {"objective": query, "search_queries": [query],
                                 "max_results": n}},
    })
    content = data.get("result", {}).get("content") or []
    text = "\n".join(c.get("text", "") for c in content if c.get("type") == "text")
    try:  # parallel 把结果包成 JSON 字符串，展开成逐条列表更好读
        parsed = json.loads(text)
        rows = parsed.get("results") or []
        out = []
        for i, r in enumerate(rows, 1):
            out.append(f"{i}. {r.get('title') or ''}\n   {r.get('url') or ''}")
            for ex in (r.get("excerpts") or [])[:2]:
                out.append("   " + " ".join(str(ex).split())[:400])
        text = "\n".join(out) or text
    except Exception:  # noqa: BLE001 — 解析失败就原样输出
        pass
    print(text.strip() or "(空)")
    return 0 if text.strip() else 1


def main() -> int:
    if len(sys.argv) < 2:
        print(__doc__)
        return 2
    query = sys.argv[1]
    try:
        n = int(sys.argv[2]) if len(sys.argv) > 2 else 5
    except ValueError:
        n = 5
    vendor = (sys.argv[3] if len(sys.argv) > 3 else "exa").lower()
    fn = parallel if vendor.startswith("par") else exa
    try:
        return fn(query, n)
    except Exception as exc:  # noqa: BLE001 — 明确把失败原因交回调用方
        print(f"[{vendor} keyless 调用失败] {type(exc).__name__}: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
