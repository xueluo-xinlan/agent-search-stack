# -*- coding: utf-8 -*-
"""淘宝尺寸关键词定向搜索。"""
import json, re, sys, time, urllib.parse, urllib.request
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
ENDPOINT = "http://127.0.0.1:8191/v1"
KWS = [("储物架 190高", 1), ("展示架 200高", 1), ("展示架 55深", 1),
       ("储物架 落地 现货", 1), ("储物架 200高", 1), ("储物架 40宽", 1)]
ID_RE = re.compile(r"(?:item\.taobao\.com|detail\.tmall\.com)/item\.htm\?id=(\d+)")
T_RE = re.compile(r'class="[^"]*title--[^"]*"[^>]*>(.*?)</div>', re.S)
P_RE = re.compile(r'priceInt--[^"]*">(\d+)</div><div class="[^"]*priceFloat--[^"]*">([\d.]*)</div>')
SOLD_RE = re.compile(r'>([\d.]+万?\+?人付款)<')
SHOP_RE = re.compile(r'shopNameText--[^"]*"[^>]*>([^<]{2,40})<')


def fetch(url):
    body = json.dumps({"cmd": "request.get", "url": url, "maxTimeout": 90000}).encode()
    req = urllib.request.Request(ENDPOINT, data=body, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=170) as r:
        return json.loads(r.read().decode("utf-8", "replace"))


ALL = {}
for kw, page in KWS:
    url = "https://s.taobao.com/search?q=%s&page=%d" % (urllib.parse.quote(kw), page)
    try:
        d = fetch(url)
        h = (d.get("solution") or {}).get("response") or ""
        seen, n = set(), 0
        for m in ID_RE.finditer(h):
            iid = m.group(1)
            if iid in seen:
                continue
            seen.add(iid)
            seg = h[max(0, m.start() - 5000):m.start() + 8000]
            t = T_RE.search(seg)
            title = re.sub(r"<[^>]+>", "", t.group(1)).strip() if t else ""
            if len(title) < 6:
                continue
            p = P_RE.search(seg)
            sm = SHOP_RE.search(seg)
            dm = SOLD_RE.search(seg)
            rec = ALL.setdefault(iid, {"id": iid, "title": title,
                                       "price": (p.group(1) + (p.group(2) or "")) if p else None,
                                       "shop": sm.group(1).strip() if sm else None,
                                       "sold": dm.group(1) if dm else None, "kws": []})
            if kw not in rec["kws"]:
                rec["kws"].append(kw)
            n += 1
        print("KW|%s|p%d|status=%s|bytes=%d|items=%d" % (kw, page, d.get("status"), len(h), n))
    except Exception as e:
        print("KW_FAIL|%s|%s" % (kw, str(e)[:80]))
    time.sleep(6)

json.dump(list(ALL.values()), open(r"C:\Users\you\flaresolverr_compat\_tb_size.json", "w", encoding="utf-8"),
          ensure_ascii=False, indent=1)
print("UNIQ=%d" % len(ALL))
print("DONE")
