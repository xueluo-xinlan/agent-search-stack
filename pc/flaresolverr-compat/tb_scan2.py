# -*- coding: utf-8 -*-
"""淘宝详情页扫描（二轮，扩样）：抽标题 / 三维尺寸 / 价格线索。"""
import json, re, sys, time, urllib.request
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
PORT = "8191"
IDS = ["670582915989", "641313883864", "776980316687", "1073516821092",
       "1073553106723", "941011056085", "946901434004", "1011702785045",
       "864201854824", "1003474522167", "921408147831", "756228990780",
       "1044732553098", "990447672580", "1015188238234", "1075597320954",
       "1061499569868", "1057059596064", "911215490628", "921039848681",
       "927646163019", "951873464176", "1044732553098", "1062718145954"]
DIM = re.compile(r"(\d{2,4})\s*[*xX\u00d7]\s*(\d{2,4})\s*[*xX\u00d7]\s*(\d{2,4})")
PROP = re.compile(r"(?:长|宽|深|高)\s*[:：]?\s*(\d{2,4})\s*(?:cm|CM|厘米|mm|MM)?")
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
        ti = re.search(r"<title>([^<]{2,220})</title>", h)
        rec["title"] = ti.group(1).strip() if ti else ""
        rec["dims"] = [x for x in dict.fromkeys(DIM.findall(h))][:25]
        rec["props"] = [x for x in dict.fromkeys(PROP.findall(h))][:25]
        rec["prices"] = list(dict.fromkeys(PRICE.findall(h)))[:8]
        print("ID|%s|%db|t=%s|dims=%s|props=%s" % (
            iid, len(h), rec["title"][:38], rec["dims"][:4], rec["props"][:6]), flush=True)
    except Exception as e:
        rec["err"] = str(e)[:140]
        print("FAIL|%s|%s" % (iid, str(e)[:100]), flush=True)
    OUT.append(rec)
    time.sleep(4)
open(r"C:\Users\you\flaresolverr_compat\_hscan2.json", "w", encoding="utf-8").write(
    json.dumps(OUT, ensure_ascii=False, indent=1))
print("DONE n=%d" % len(OUT))
