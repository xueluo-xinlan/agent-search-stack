# -*- coding: utf-8 -*-
"""多站商品搜索（经 PC 抓取层 127.0.0.1:8191）-> 结构化结果。

用法:
  python shop_search.py dangdang "模型"
  python shop_search.py smzdm "模型" --limit 10 --json
  python shop_search.py taobao "储物架"

站点与登录依赖（2026-10 实测）:
  dangdang —— 免登录，稳定出「书名/现价/原价/折扣」
  smzdm    —— 免登录，好价爆料，价格含「到手价/降价前/上次爆料价」并标注平台
  taobao   —— 需 profile 内的淘宝登录态（未登录只返回骨架页）
"""
import argparse
import json
import re
import sys
import urllib.parse
import urllib.request

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

ENDPOINT = "http://127.0.0.1:8191/v1"


def fetch(url):
    body = json.dumps({"cmd": "request.get", "url": url, "maxTimeout": 90000}).encode()
    req = urllib.request.Request(ENDPOINT, data=body,
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=175) as r:
        d = json.loads(r.read().decode("utf-8", "replace"))
    s = d.get("solution") or {}
    return d.get("status"), s.get("response") or "", s.get("url") or ""


def anchors_of(html, pat):
    out, seen = [], set()
    for m in re.finditer(pat, html):
        g = m.group(1)
        if g in seen:
            continue
        seen.add(g)
        out.append((m.start(), g))
    return out


def parse_dangdang(html, limit):
    a = anchors_of(html, r"product\.dangdang\.com/(\d+)\.html")
    items = []
    for k, (pos, iid) in enumerate(a):
        if len(items) >= limit:
            break
        end = a[k + 1][0] if k + 1 < len(a) else min(len(html), pos + 20000)
        seg = html[max(0, pos - 2200):end]
        pm = re.search(r'class="price_n">\s*¥\s?([\d.]+)\s*<', seg)
        lm = re.search(r'class="price_r">\s*¥\s?([\d.]+)\s*<', seg)
        dm = re.search(r'class="price_s">\s*\(([\d.]+)折\)', seg)
        tm = re.search(r'name="title">\s*<a[^>]*title="([^"]{4,200})"', seg)
        if not tm:
            tm = re.search(r'alt="([^"]{6,200})"', seg)
        items.append({
            "site": "dangdang",
            "id": iid,
            "title": (tm.group(1).strip() if tm else ""),
            "price": pm.group(1) if pm else None,
            "list_price": lm.group(1) if lm else None,
            "discount": (dm.group(1) + "折") if dm else None,
            "url": "http://product.dangdang.com/%s.html" % iid,
        })
    return items


PLATFORMS = ("京东", "天猫", "淘宝", "拼多多", "苏宁", "亚马逊", "唯品会", "网易严选")


def parse_smzdm(html, limit):
    a = anchors_of(html, r"(?:www|post)\.smzdm\.com/p/(\w+)")
    items = []
    for k, (pos, pid) in enumerate(a):
        if len(items) >= limit:
            break
        end = a[k + 1][0] if k + 1 < len(a) else min(len(html), pos + 20000)
        seg = html[max(0, pos - 1200):end]
        txt = " ".join(re.sub(r"<[^>]+>", " ", seg).split())
        cur = re.search(r"到手价\s?([\d.]+)\s?元", txt) or re.search(r"([\d]+\.[\d]{2})\s?元", txt)
        was = re.search(r"降价前售价为\s?([\d.]+)\s?元", txt) or re.search(r"原价\s?([\d.]+)\s?元", txt)
        last = re.search(r"上次爆料价\s?([\d.]+)\s?元", txt)
        plat = next((p for p in PLATFORMS if p in txt), None)
        tm = re.search(r'title="([^"]{8,160})"', seg)
        if not tm:
            tm = re.search(r">([^<>]{12,120})<", seg)
        items.append({
            "site": "smzdm",
            "id": pid,
            "title": (tm.group(1).strip() if tm else ""),
            "price": cur.group(1) if cur else None,
            "was_price": was.group(1) if was else None,
            "last_price": last.group(1) if last else None,
            "platform": plat,
            "url": "https://www.smzdm.com/p/%s/" % pid,
        })
    return items


def parse_taobao(html, limit):
    a = anchors_of(html, r"(?:item\.taobao\.com|detail\.tmall\.com)/item\.htm\?id=(\d+)")
    items = []
    for k, (pos, iid) in enumerate(a):
        if len(items) >= limit:
            break
        end = a[k + 1][0] if k + 1 < len(a) else min(len(html), pos + 15000)
        seg = html[max(0, pos - 2500):end]
        pm = re.search(
            r'priceInt--[^"]*">(\d+)</div><div class="[^"]*priceFloat--[^"]*">([\d.]*)</div>', seg)
        price = (pm.group(1) + (pm.group(2) or "")) if pm else None
        tm = re.search(r'title="([^"]{6,200})"', seg)
        sold = re.search(r">([\d.]+万?\+?人付款)<", seg)
        items.append({
            "site": "taobao",
            "id": iid,
            "title": (tm.group(1).strip() if tm and not tm.group(1).startswith("http") else ""),
            "price": price,
            "sold": sold.group(1) if sold else None,
            "url": "https://item.taobao.com/item.htm?id=%s" % iid,
        })
    return items


SITES = {
    "dangdang": ("https://search.dangdang.com/?key=%s", parse_dangdang),
    "smzdm":    ("https://search.smzdm.com/?c=home&s=%s", parse_smzdm),
    "taobao":   ("https://s.taobao.com/search?q=%s", parse_taobao),
}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("site", choices=sorted(SITES))
    ap.add_argument("keyword")
    ap.add_argument("--limit", type=int, default=15)
    ap.add_argument("--json", action="store_true")
    a = ap.parse_args()

    tpl, parser = SITES[a.site]
    url = tpl % urllib.parse.quote(a.keyword)
    st, html, fin = fetch(url)
    if st != "ok" or not html:
        print(json.dumps({"ok": False, "error": "fetch_failed", "status": st}, ensure_ascii=False))
        return 1

    items = parser(html, a.limit)
    if a.json:
        print(json.dumps({"ok": True, "site": a.site, "keyword": a.keyword,
                          "final": fin, "bytes": len(html),
                          "count": len(items), "items": items},
                         ensure_ascii=False, indent=1))
    else:
        print("%s 搜索「%s」 解析 %d 条 (%d bytes)" % (a.site, a.keyword, len(items), len(html)))
        for n, it in enumerate(items, 1):
            extra = " | ".join(x for x in (
                ("原价¥" + it["list_price"]) if it.get("list_price") else None,
                it.get("discount"),
                ("平台:" + it["platform"]) if it.get("platform") else None,
                ("前价" + it["was_price"] + "元") if it.get("was_price") else None,
                it.get("sold"),
            ) if x)
            print("%2d) ¥%-9s %s" % (n, it["price"] or "?", it["title"][:56] or "(无标题)"))
            if extra:
                print("     %s" % extra)
    return 0


if __name__ == "__main__":
    sys.exit(main())
