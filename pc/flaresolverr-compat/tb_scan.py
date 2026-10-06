# -*- coding: utf-8 -*-
"""淘宝详情页扫描：抽取标题 / SKU 尺寸 / 价格线索。经 PC 抓取层 8191。"""
import json, re, sys, time, urllib.request
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
PORT = "8191"
IDS = ["1075905736593", "779812127004", "952153843888", "1082448047152",
       "1009485908095", "1038893624066", "618206689971", "900604866694",
       "1014943327052", "861221788140", "994282838313", "1062449514397"]
DIM = re.compile(r"(\d{2,4})\s*[*xX\u00d7]\s*(\d{2,4})\s*[*xX\u00d7]\s*(\d{2,4})")
SKU = re.compile(r'(?:"skuName"|"valueName"|"propValue")\s*:\s*"([^"]{2,70})"')
PRICE = re.compile(r'"(?:priceText|price|subPrice)"\s*:\s*"?([\d]{1,6}(?:\.\d{1,2})?)"?')


def fetch(url):
    body = json.dumps({"cmd": "request.get", "url": url, "maxTimeout": 90000}).encode()
    req = urllib.request.Request("http://127.0.0.1:%s/v1" % PORT, data=body,
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=175) as r:
        return json.loads(r.read().decode("utf-8", "replace"))


OUT = []
for iid in IDS:
    rec = {"id": iid}
    try:
        d = fetch("https://item.taobao.com/item.htm?id=" + iid)
        s = d.get("solution") or {}
        h = s.get("response") or ""
        rec["bytes"] = len(h)
        rec["final"] = (s.get("url") or "")[:110]
        ti = re.search(r"<title>([^<]{2,220})</title>", h)
        rec["title"] = ti.group(1).strip() if ti else ""
        dims = [x for x in dict.fromkeys(DIM.findall(h))]
        rec["dims"] = dims[:25]
        rec["sku"] = list(dict.fromkeys(SKU.findall(h)))[:25]
        rec["prices"] = list(dict.fromkeys(PRICE.findall(h)))[:8]
        rec["login"] = ("login.taobao" in h) or ("x5sec" in h) or ("punish" in h)
        print("ID|%s|%db|t=%s|dims=%s|sku=%d|login=%s" % (
            iid, len(h), rec["title"][:44], dims[:4], len(rec["sku"]), rec["login"]), flush=True)
    except Exception as e:
        rec["err"] = str(e)[:140]
        print("FAIL|%s|%s" % (iid, str(e)[:110]), flush=True)
    OUT.append(rec)
    time.sleep(6)
open(r"C:\Users\you\flaresolverr_compat\_hscan.json", "w", encoding="utf-8").write(
    json.dumps(OUT, ensure_ascii=False, indent=1))
print("DONE n=%d" % len(OUT))
