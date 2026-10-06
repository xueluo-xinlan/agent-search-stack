# -*- coding: utf-8 -*-
"""淘宝指定 SKU 详情探针：价格 / 材质 / 现货 / SKU 尺寸。经 PC 抓取层 8191。"""
import json, re, sys, time, urllib.request
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
D = r"C:\Users\you\flaresolverr_compat"
IDS = ["864201854824", "756228990780", "1044732553098",
       "951873464176", "1061499569868", "941011056085"]
DIM = re.compile(r"(\d{2,4})\s*[*xX\u00d7]\s*(\d{2,4})\s*[*xX\u00d7]\s*(\d{2,4})")
PROP = re.compile(r'(?:"propValue"|"valueName"|"skuName"|"propName")\s*:\s*"([^"]{2,60})"')
PRICE = re.compile(r'"(?:priceText|price|subPrice|promotionPrice|priceMoney|extraPrice)"\s*:\s*"?([\d]{1,6}(?:\.\d{1,2})?)"?')
MAT = ["钢制", "铁皮", "冷轧", "碳钢", "金属", "铝合金", "实木", "橡胶木", "颗粒板",
       "密度板", "人造板", "多层板", "亚克力", "钢化玻璃", "玻璃"]
STOCK = ["现货", "当天发货", "24小时", "48小时内", "预售", "定制", "定做", "工期", "7天", "15天"]


def fetch(url):
    body = json.dumps({"cmd": "request.get", "url": url, "maxTimeout": 90000}).encode()
    req = urllib.request.Request("http://127.0.0.1:8191/v1", data=body,
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=175) as r:
        return json.loads(r.read().decode("utf-8", "replace"))


out = []
for iid in IDS:
    rec = {"id": iid}
    try:
        d = fetch("https://item.taobao.com/item.htm?id=" + iid)
        s = d.get("solution") or {}
        h = s.get("response") or ""
        rec["bytes"] = len(h)
        rec["final"] = (s.get("url") or "")[:120]
        ti = re.search(r"<title>([^<]{2,220})</title>", h)
        rec["title"] = ti.group(1).strip() if ti else ""
        rec["dims"] = list(dict.fromkeys(DIM.findall(h)))[:25]
        rec["props"] = list(dict.fromkeys(PROP.findall(h)))[:40]
        rec["prices"] = list(dict.fromkeys(PRICE.findall(h)))[:12]
        rec["material"] = {m: h.count(m) for m in MAT if m in h}
        rec["stock"] = {k: h.count(k) for k in STOCK if k in h}
        rec["login"] = ("login.taobao" in h) or ("x5sec" in h) or ("punish" in h)
        print("ID|%s|%db|login=%s|t=%s" % (iid, len(h), rec["login"], rec["title"][:62]), flush=True)
        print("   prices=%s" % rec["prices"][:8], flush=True)
        print("   mat=%s" % rec["material"], flush=True)
        print("   stock=%s" % rec["stock"], flush=True)
        print("   dims=%s" % rec["dims"][:10], flush=True)
        print("   props=%s" % rec["props"][:22], flush=True)
        open(D + r"\_det_%s.html" % iid, "w", encoding="utf-8").write(h)
    except Exception as e:
        rec["err"] = str(e)[:140]
        print("FAIL|%s|%s" % (iid, str(e)[:120]), flush=True)
    out.append(rec)
    time.sleep(7)
open(D + r"\_skudet.json", "w", encoding="utf-8").write(
    json.dumps(out, ensure_ascii=False, indent=1))
print("DONE n=%d" % len(out))
