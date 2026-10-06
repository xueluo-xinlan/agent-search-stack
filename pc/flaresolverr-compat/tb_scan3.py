# -*- coding: utf-8 -*-
"""钢制书柜候选：抓 SKU 尺寸档 + 材质 + 现货关键词。"""
import json, re, sys, time, urllib.request
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
D = r"C:\Users\you\flaresolverr_compat"
IDS = ["861221788140", "1060749996586", "1002089181633",
       "1062449514397", "1068569329496", "927646163019"]
DIM = re.compile(r"(\d{2,4})\s*[*xX\u00d7]\s*(\d{2,4})\s*[*xX\u00d7]\s*(\d{2,4})")
PROP = re.compile(r'(?:"propValue"|"valueName")\s*:\s*"([^"]{2,60})"')
MAT = ["钢制", "铁皮", "冷轧", "金属", "实木", "颗粒板", "密度板", "板材"]
STOCK = ["现货", "48小时内", "当天发货", "预售", "定制"]


def fetch(url):
    body = json.dumps({"cmd": "request.get", "url": url, "maxTimeout": 90000}).encode()
    req = urllib.request.Request("http://127.0.0.1:8191/v1", data=body,
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=175) as r:
        return json.loads(r.read().decode("utf-8", "replace"))


for iid in IDS:
    try:
        d = fetch("https://item.taobao.com/item.htm?id=" + iid)
        s = d.get("solution") or {}
        h = s.get("response") or ""
        ti = re.search(r"<title>([^<]{2,220})</title>", h)
        title = ti.group(1).strip() if ti else ""
        dims = list(dict.fromkeys(DIM.findall(h)))[:18]
        props = list(dict.fromkeys(PROP.findall(h)))[:26]
        mat = {m: h.count(m) for m in MAT if m in h}
        stock = {k: h.count(k) for k in STOCK if k in h}
        hs = sorted({int(x[2]) for x in dims if len(x) == 3 and x[2].isdigit()})
        print("ID|%s|%db|max_h=%s|t=%s" % (iid, len(h), hs[-4:] if hs else [], title[:48]), flush=True)
        print("   mat=%s stock=%s" % (mat, stock), flush=True)
        print("   dims=%s" % dims[:12], flush=True)
    except Exception as e:
        print("FAIL|%s|%s" % (iid, str(e)[:100]), flush=True)
    time.sleep(6)
print("DONE")
