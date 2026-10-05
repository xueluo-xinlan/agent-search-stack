#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""两条 MCP 通道的端到端探针（真实发起 tools/call，测量延迟与返回内容）。

用法:
  python3 mcp_probe.py local [query]   # A-lite：VPS 本地 node 网关
  python3 mcp_probe.py pc    [query]   # B2   ：经 pc-link.sock 走 SSH 到 Windows PC
"""
import json
import subprocess
import sys
import threading
import time

CMD = {
    "local": [
        "/usr/local/bin/node", "/opt/agent_search_gateway/dist/index.js", "--stdio",
    ],
    "pc": [
        "ssh", "-S", "/run/pc-link.sock", "-p", "2222", "-o", "BatchMode=yes",
        "wei@127.0.0.1",
        "node", "C:/Users/you/agent_search_gateway-master/dist/index.js", "--stdio",
    ],
}
LABEL = {"local": "A-lite (VPS 本地)", "pc": "B2 (Windows PC 经反向隧道)"}


def main() -> int:
    which = sys.argv[1] if len(sys.argv) > 1 else "local"
    query = sys.argv[2] if len(sys.argv) > 2 else "comfyui 工作流 教程"
    if which not in CMD:
        print("usage: mcp_probe.py <local|pc> [query]")
        return 2

    print("=== %s ===" % LABEL[which])
    proc = subprocess.Popen(
        CMD[which], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
        stderr=subprocess.PIPE, text=True, bufsize=1,
    )
    inbox: dict[int, dict] = {}
    errs: list[str] = []
    lock = threading.Lock()

    def rd(stream, collect):
        for line in stream:
            line = line.strip()
            if not line:
                continue
            if collect:
                errs.append(line)
                continue
            try:
                msg = json.loads(line)
            except json.JSONDecodeError:
                continue
            if "id" in msg:
                with lock:
                    inbox[msg["id"]] = msg

    threading.Thread(target=rd, args=(proc.stdout, False), daemon=True).start()
    threading.Thread(target=rd, args=(proc.stderr, True), daemon=True).start()

    counter = [0]

    def send(method, params=None, notify=False):
        with lock:
            counter[0] += 1
            mid = counter[0]
        payload = {"jsonrpc": "2.0", "method": method}
        if params is not None:
            payload["params"] = params
        if not notify:
            payload["id"] = mid
        proc.stdin.write(json.dumps(payload) + "\n")
        proc.stdin.flush()
        return mid

    def wait(mid, timeout=120):
        end = time.time() + timeout
        while time.time() < end:
            with lock:
                if mid in inbox:
                    return inbox.pop(mid)
            time.sleep(0.05)
        return None

    def call(method, params, label, timeout=120):
        t0 = time.time()
        resp = wait(send(method, params), timeout)
        dt = time.time() - t0
        ok = bool(resp and "result" in resp)
        print("  [%s] %-22s %6.2fs" % ("OK " if ok else "ERR", label, dt))
        return resp, dt

    r, _ = call("initialize", {
        "protocolVersion": "2024-11-05", "capabilities": {},
        "clientInfo": {"name": "probe", "version": "1.0"},
    }, "initialize", 60)
    if not r:
        print("  ! initialize 无响应")
        proc.terminate()
        return 1
    print("      server = %s v%s" % (r["result"]["serverInfo"]["name"], r["result"]["serverInfo"]["version"]))
    send("notifications/initialized", notify=True)

    r, _ = call("tools/call", {"name": "health", "arguments": {}}, "health", 90)
    if r and "result" in r:
        txt = "\n".join(c.get("text", "") for c in r["result"]["content"])
        print("      " + " ".join(txt.split())[:260])

    r, dt = call("tools/call", {"name": "search", "arguments": {"query": query, "num_results": 5}}, "search", 120)
    if r and "result" in r:
        txt = "\n".join(c.get("text", "") for c in r["result"]["content"])
        body = txt.split("## 结果", 1)[-1].strip().splitlines()
        print("      chars=%d end2end=%.2fs" % (len(txt), dt))
        for ln in body[:4]:
            print("      " + ln[:110])

    r, dt = call("tools/call", {"name": "fetch", "arguments": {"url": "https://www.bilibili.com/", "max_chars": 300}}, "fetch", 120)
    if r and "result" in r:
        txt = "\n".join(c.get("text", "") for c in r["result"]["content"])
        print("      chars=%d end2end=%.2fs | %s" % (len(txt), dt, " ".join(txt.split())[:120]))

    proc.stdin.close()
    proc.terminate()
    for line in errs[:6]:
        print("      log: " + line[:150])
    return 0


if __name__ == "__main__":
    sys.exit(main())
