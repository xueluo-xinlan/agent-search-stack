# -*- coding: utf-8 -*-
"""从京东 chanpin（品类聚合）页提取 item.jd.com 商品链接 + 上下文（含尺寸文字）。"""
import json, re, sys, time, urllib.request
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
PORT = "8191"
URLS = ["https://www.jd.com/chanpin/1199604.html",
        "https://www.jd.com/chanpin/2231215.html",
        "https://www.jd.com/chanpin/58922.html",
        "https://www.jd.com/chanpin/55489.html"]


def fetch(url):
    body = json.dumps({"cmd": "request.get", "url": url, "maxTimeout": 90000}).encode()
    req = urllib.request.Request("http://127.0.0.1:%s/v1" % PORT, data=body,
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=175) as r:
        return json.loads(r.read().decode("utf-8", "replace"))


OUT = []
for u in URLS:
    try:
        d = fetch(u)
        s = d.get("solution") or {}
        h = s.get("response") or ""
        links, seen = [], set()
        for m in re.finditer(r"item\.jd\.com/(\d+)\.html", h):
            i = m.group(1)
            if i in seen:
                continue
            seen.add(i)
            seg = re.sub(r"<[^>]+>", " ", h[max(0, m.start() - 1300):m.start() + 700])
            seg = " ".join(seg.split())
            links.append({"sku": i, "ctx": seg[:240]})
        print("URL|%s|bytes=%d|links=%d" % (u, len(h), len(links)), flush=True)
        for L in links[:40]:
            print("  %s | %s" % (L["sku"], L["ctx"][:170]), flush=True)
        OUT.append({"url": u, "links": links})
    except Exception as e:
        print("FAIL|%s|%s" % (u, str(e)[:110]), flush=True)
    time.sleep(6)
open(r"C:\Users\you\flaresolverr_compat\_jdlinks.json", "w", encoding="utf-8").write(
    json.dumps(OUT, ensure_ascii=False, indent=1))
print("DONE")
