#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Hermes MCP server：把多源直连检索器 source_search.py 暴露为工具 `source_search`。

传输：stdio，每行一个 JSON-RPC 消息（MCP stdio transport）。
依赖：仅标准库 + ~/source_search.py（同为仅标准库实现）。
注意：stdout 只允许出现 JSON-RPC；任何日志走 stderr。
"""
from __future__ import annotations

import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import source_search as ss  # noqa: E402

PROTOCOL = "2024-11-05"
SERVER = {"name": "source-search", "version": "1.0.0"}
TOOL = {
    "name": "source_search",
    "description": (
        "多源直连检索：直连 wikipedia / hn(Algolia) / arxiv / stackexchange / github / crossref / ddg "
        "的官方 API，0.4–1.1s 返回高相关条目。用于技术、学术、事实/定义类查询，"
        "可绕开已失效的 SearXNG 引擎适配器。中文查询用 lang=zh；英文技术问题建议 --sources arxiv,github,so,hn。"
    ),
    "inputSchema": {
        "type": "object",
        "properties": {
            "query": {"type": "string", "description": "查询词（中文或英文）"},
            "lang": {"type": "string", "enum": ["zh", "en"], "default": "zh",
                     "description": "wikipedia 语言版本"},
            "sources": {"type": "string",
                        "description": "逗号分隔源名，默认 6 个。可选：wikipedia,hn,arxiv,so,github,crossref,ddg。"
                                       "中文技术建议 wikipedia,github,crossref；英文建议 arxiv,github,so,hn"},
            "limit": {"type": "integer", "default": 5, "description": "每个源返回条数"},
        },
        "required": ["query"],
    },
}


def send(obj):
    sys.stdout.write(json.dumps(obj, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def handle_call(params):
    args = params.get("arguments") or {}
    q = (args.get("query") or "").strip()
    if not q:
        return {"content": [{"type": "text", "text": "缺少 query 参数"}], "isError": True}

    raw_sources = args.get("sources") or ",".join(ss.DEFAULT_SOURCES)
    names = [n.strip() for n in raw_sources.split(",") if n.strip() in ss.SOURCES]
    if not names:
        return {"content": [{"type": "text",
                             "text": "无有效源，可选：" + ", ".join(ss.SOURCES)}], "isError": True}

    lang = args.get("lang") or "zh"
    try:
        limit = int(args.get("limit") or 5)
    except (TypeError, ValueError):
        limit = 5

    res = ss.run(q, lang, limit, names)

    lines = [f"查询: {q}   源={','.join(names)}"]
    for n in names:
        v = res.get(n, {})
        if not v.get("ok"):
            lines.append(f"\n## {n} ✗ {v.get('error')}")
            continue
        lines.append(f"\n## {n}（{len(v['items'])} 条，{v['sec']}s）")
        for it in v["items"]:
            lines.append(f"- {it['title']}")
            if it.get("snippet"):
                lines.append(f"  {it['snippet'][:200]}")
            if it.get("url"):
                lines.append(f"  {it['url']}")
            if it.get("meta"):
                lines.append(f"  [{it['meta']}]")
    return {"content": [{"type": "text", "text": "\n".join(lines)}]}


def main():
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            msg = json.loads(line)
        except Exception:
            continue
        mid = msg.get("id")
        method = msg.get("method")

        if method == "initialize":
            send({"jsonrpc": "2.0", "id": mid, "result": {
                "protocolVersion": PROTOCOL, "capabilities": {"tools": {}}, "serverInfo": SERVER}})
        elif method == "tools/list":
            send({"jsonrpc": "2.0", "id": mid, "result": {"tools": [TOOL]}})
        elif method == "tools/call":
            try:
                r = handle_call(msg.get("params") or {})
            except Exception as e:  # 单次调用失败不影响服务
                r = {"content": [{"type": "text", "text": f"内部错误: {type(e).__name__}: {e}"}],
                     "isError": True}
            send({"jsonrpc": "2.0", "id": mid, "result": r})
        elif method == "ping":
            send({"jsonrpc": "2.0", "id": mid, "result": {}})
        elif isinstance(method, str) and method.startswith("notifications/"):
            continue
        elif mid is not None:
            send({"jsonrpc": "2.0", "id": mid,
                  "error": {"code": -32601, "message": f"method not found: {method}"}})


if __name__ == "__main__":
    main()
