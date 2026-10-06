# -*- coding: utf-8 -*-
"""苏宁搜索页抓取（标题常带尺寸），经 PC 抓取层。"""
import json, re, sys, time, urllib.parse, urllib.request
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
ENDPOINT = "http://127.0.0.1:8191/v1"
KWS = ["储物架", "玻璃展示架", "展示架 现货"]
LINK = re.compile(r"(?:https?:)?//product\.suning\.com/(\d+)/(\d+)\.html")


def fetch(url):
    body = json.dumps({"cmd": "request.get", "url": url, "maxTimeout": 90000}).encode()
    req = urllib.request.Request(ENDPOINT, data=body, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=170) as r:
        return json.loads(r.read().decode("utf-8", "replace"))


ALL = []
for kw in KWS:
    url = "https://search.suning.com/%s/" % urllib.parse.quote(kw)
    try:
        d = fetch(url)
        s = d.get("solution") or {}
        h = s.get("response") or ""
        ids, seen = [], set()
        for m in LINK.finditer(h):
            k = m.group(1) + "/" + m.group(2)
            if k in seen:
                continue
            seen.add(k)
            ids.append((m.start(), k))
        print("KW|%s|status=%s|bytes=%d|final=%s|items=%d" % (kw, d.get("status"), len(h), (s.get("url") or "")[:60], len(ids)))
        for k, (pos, sid) in enumerate(ids[:12]):
            end = ids[k + 1][0] if k + 1 < len(ids) else pos + 6000
            seg = h[max(0, pos - 4000):end]
            txt = re.sub(r"<[^>]+>", " ", seg)
            txt = re.sub(r"\s+", " ", txt).strip()
            price = re.search(r"(?:¥|￥)\s*([\d,]+(?:\.\d+)?)", seg)
            print("   %s | %s | %s" % (sid, (price.group(1) if price else "?"), txt[:150]))
            ALL.append({"kw": kw, "sku": sid, "price": price.group(1) if price else None,
                        "url": "https://product.suning.com/%s.html" % sid, "text": txt[:400]})
    except Exception as e:
        print("KW_FAIL|%s|%s" % (kw, str(e)[:90]))
    time.sleep(8)

json.dump(ALL, open(r"C:\Users\you\flaresolverr_compat\_suning.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print("TOTAL=%d" % len(ALL))
print("DONE")
