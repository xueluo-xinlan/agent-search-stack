# -*- coding: utf-8 -*-
"""淘宝多关键词搜索采集 -> 结构化 JSON（经 PC 抓取层 8191）。"""
import json, re, sys, time, urllib.parse, urllib.request
sys.stdout.reconfigure(encoding="utf-8", errors="replace")

ENDPOINT = "http://127.0.0.1:8191/v1"
# (关键词, 页码)
KWS = [("储物架", 1), ("储物架", 2), ("储物展示架", 1), ("模型展示架", 1),
       ("玻璃展示架", 1), ("储物架 200高", 1)]

ID_RE = re.compile(r"(?:item\.taobao\.com|detail\.tmall\.com)/item\.htm\?id=(\d+)")
PRICE_RE = re.compile(r'priceInt--[^"]*">(\d+)</div><div class="[^"]*priceFloat--[^"]*">([\d.]*)</div>')
TITLE_RE = re.compile(r'title="([^"]{6,200})"')
SOLD_RE = re.compile(r'>([\d.]+万?\+?人付款)<')
SHOP_RE = re.compile(r'shopName--[^"]*"[^>]*>([^<]{2,40})<')


def fetch(url):
    body = json.dumps({"cmd": "request.get", "url": url, "maxTimeout": 90000}).encode()
    req = urllib.request.Request(ENDPOINT, data=body, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=170) as r:
        return json.loads(r.read().decode("utf-8", "replace"))


def parse(html, limit=60):
    anchors, seen = [], set()
    for m in ID_RE.finditer(html):
        iid = m.group(1)
        if iid in seen:
            continue
        seen.add(iid)
        anchors.append((m.start(), iid))
    items = []
    for k, (pos, iid) in enumerate(anchors):
        if len(items) >= limit:
            break
        end = anchors[k + 1][0] if k + 1 < len(anchors) else min(len(html), pos + 20000)
        seg = html[max(0, pos - 3000):end]
        pm = PRICE_RE.search(seg)
        price = (pm.group(1) + (pm.group(2) or "")) if pm else None
        tm = TITLE_RE.search(seg)
        title = tm.group(1).strip() if tm and not tm.group(1).startswith("http") else ""
        if not title:
            tm2 = re.search(r">\s*([^<>]{8,140}?)\s*</(?:span|div|a)>", seg)
            title = tm2.group(1).strip() if tm2 else ""
        sm = SHOP_RE.search(seg)
        dm = SOLD_RE.search(seg)
        items.append({"id": iid, "title": title, "price": price,
                      "shop": sm.group(1).strip() if sm else None,
                      "sold": dm.group(1) if dm else None,
                      "url": "https://item.taobao.com/item.htm?id=" + iid})
    return items


ALL = []
for kw, page in KWS:
    url = "https://s.taobao.com/search?q=%s&page=%d" % (urllib.parse.quote(kw), page)
    try:
        d = fetch(url)
        s = d.get("solution") or {}
        h = s.get("response") or ""
        its = parse(h)
        print("KW|%s|p%d|status=%s|bytes=%d|items=%d" % (kw, page, d.get("status"), len(h), len(its)))
        open(r"C:\Users\you\flaresolverr_compat\_tb2_p%d_%s.html" % (page, abs(hash(kw)) % 10000),
             "w", encoding="utf-8").write(h)
        for it in its:
            it["kw"] = kw
            it["page"] = page
            ALL.append(it)
    except Exception as e:
        print("KW_FAIL|%s|p%d|%s" % (kw, page, str(e)[:90]))
    time.sleep(6)

out = r"C:\Users\you\flaresolverr_compat\_shop_multi2.json"
json.dump(ALL, open(out, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print("TOTAL=%d" % len(ALL))
print("DONE")
