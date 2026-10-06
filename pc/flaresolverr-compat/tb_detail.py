# -*- coding: utf-8 -*-
"""淘宝商品详情页探针：找 SKU 尺寸与规格。"""
import json, re, sys, time, urllib.request
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
ENDPOINT = "http://127.0.0.1:8191/v1"
D = r"C:\Users\you\flaresolverr_compat"
items = json.load(open(D + r"\_tb_size.json", encoding="utf-8"))
# 挑落地款/高柜（价格 60-1000，标题含落地或高柜字样）
cand = [x for x in items if x.get("price") and 60 <= float(x["price"]) <= 1000 and
        re.search(r"落地|高柜|立式|靠墙|一体", x["title"])]
seen, pick = set(), []
for x in sorted(cand, key=lambda y: -len(y["title"])):
    if x["id"] in seen:
        continue
    seen.add(x["id"])
    pick.append(x)
    if len(pick) >= 5:
        break
print("候选=%d 取样=%d" % (len(cand), len(pick)))


def fetch(url):
    body = json.dumps({"cmd": "request.get", "url": url, "maxTimeout": 90000}).encode()
    req = urllib.request.Request(ENDPOINT, data=body, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=170) as r:
        return json.loads(r.read().decode("utf-8", "replace"))


DIM = re.compile(r"(\d{2,4})\s*[*×xX]\s*(\d{2,4})\s*[*×xX]\s*(\d{2,4})")
out = []
for it in pick:
    url = "https://item.taobao.com/item.htm?id=" + it["id"]
    try:
        d = fetch(url)
        s = d.get("solution") or {}
        h = s.get("response") or ""
        keys = {k: h.count(k) for k in ("skuBase", "skuMap", "尺寸", "规格", "cm", "mm", "login.taobao", "x5sec", "punish")}
        dims = sorted(set(DIM.findall(h)))[:12]
        print("ID %s bytes=%d final=%s" % (it["id"], len(h), (s.get("url") or "")[:60]))
        print("   keys=%s" % keys)
        print("   dims=%s" % dims)
        out.append({"id": it["id"], "title": it["title"], "price": it["price"], "bytes": len(h),
                    "keys": keys, "dims": dims, "final": s.get("url")})
        open(D + r"\_tbdet_%s.html" % it["id"], "w", encoding="utf-8").write(h)
    except Exception as e:
        print("FAIL|%s|%s" % (it["id"], str(e)[:90]))
    time.sleep(7)
json.dump(out, open(D + r"\_tb_detail.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print("DONE")
