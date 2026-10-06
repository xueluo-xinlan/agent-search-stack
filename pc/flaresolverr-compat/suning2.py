# -*- coding: utf-8 -*-
"""苏宁多关键词搜索：商品名内带完整规格（mm），提取 名/价/尺寸。"""
import json, re, sys, time, urllib.parse, urllib.request
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
ENDPOINT = "http://127.0.0.1:8191/v1"
KWS = ["储物架", "玻璃展柜", "模型展示架", "钢制展示架", "储物架 现货", "展示架 落地", "铁皮架 模型"]
LINK = re.compile(r"//product\.suning\.com/(\d+)/(\d+)\.html")
DIM = re.compile(r"(\d{3,4})\s*[*×xX]\s*(\d{3,4})\s*[*×xX]\s*(\d{3,4})")


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
        anchors, seen = [], set()
        for m in LINK.finditer(h):
            k = m.group(1) + "/" + m.group(2)
            if k in seen:
                continue
            seen.add(k)
            anchors.append((m.start(), k))
        got = 0
        for i, (pos, sid) in enumerate(anchors):
            end = anchors[i + 1][0] if i + 1 < len(anchors) else pos + 7000
            seg = h[pos:end]
            txt = re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", seg)).strip()
            pm = re.search(r"(?:到手价|¥|￥)\s*(?:¥|￥)?\s*([\d,]+(?:\.\d+)?)", txt)
            dm = DIM.search(txt)
            name = ""
            nm = re.search(r"到手价\s*(.{6,90}?)(?:\s+(?:优质|简约|金属|苏宁|领券|\d+\s*评价|0\s*评价)|$)", txt)
            if nm:
                name = nm.group(1).strip()
            else:
                nm2 = re.search(r'title="([^"]{6,90})"', seg)
                name = nm2.group(1) if nm2 else txt[:70]
            if not name and not dm:
                continue
            ALL.append({"kw": kw, "sku": sid, "price": pm.group(1) if pm else None,
                        "dims_mm": [int(x) for x in dm.groups()] if dm else None,
                        "name": name, "url": "https://product.suning.com/%s.html" % sid})
            got += 1
        print("KW|%s|bytes=%d|items=%d" % (kw, len(h), got))
    except Exception as e:
        print("KW_FAIL|%s|%s" % (kw, str(e)[:90]))
    time.sleep(8)

json.dump(ALL, open(r"C:\Users\you\flaresolverr_compat\_suning2.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print("TOTAL=%d  with_dims=%d" % (len(ALL), sum(1 for a in ALL if a["dims_mm"])))
print("DONE")
