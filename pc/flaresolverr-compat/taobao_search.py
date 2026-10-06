# -*- coding: utf-8 -*-
"""淘宝搜索（经 PC 抓取层 127.0.0.1:8191）-> 结构化商品列表。

用法:
  python taobao_search.py "储物架"                    # 人类可读
  python taobao_search.py "储物架" --json             # JSON（供程序消费）
  python taobao_search.py "储物架" --page 2 --limit 30

说明:
  - 淘宝搜索页的价格是「未登录可见」的公开渲染结果，无需任何账号。
  - class 名带构建哈希（如 priceInt--yqqZMJ5a），故一律按前缀匹配，避免随构建失效。
  - 商品区间按商品 ID 锚点切分，区间内取第一个价格（列表页价格即展示价）。
"""
import argparse
import json
import re
import sys
import urllib.parse
import urllib.request

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

ENDPOINT = "http://127.0.0.1:8191/v1"

ID_RE = re.compile(r"(?:item\.taobao\.com|detail\.tmall\.com)/item\.htm\?id=(\d+)")
PRICE_RE = re.compile(
    r'priceInt--[^"]*">(\d+)</div><div class="[^"]*priceFloat--[^"]*">([\d.]*)</div>')
TITLE_RE = re.compile(r'title="([^"]{6,200})"')
SHOP_RE = re.compile(r'shopName--[^"]*"[^>]*>([^<]{2,40})<')
SOLD_RE = re.compile(r">([\d.]+万?\+?人付款)<")


def fetch(keyword, page):
    url = "https://s.taobao.com/search?q=%s&page=%d" % (urllib.parse.quote(keyword), page)
    body = json.dumps({"cmd": "request.get", "url": url, "maxTimeout": 90000}).encode()
    req = urllib.request.Request(ENDPOINT, data=body,
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=160) as r:
        d = json.loads(r.read().decode("utf-8", "replace"))
    s = d.get("solution") or {}
    return s.get("response") or "", (s.get("url") or ""), d.get("status")


def parse(html, limit):
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
        end = anchors[k + 1][0] if k + 1 < len(anchors) else min(len(html), pos + 15000)
        seg = html[max(0, pos - 2500):end]

        price = None
        pm = PRICE_RE.search(seg)
        if pm:
            price = pm.group(1) + (pm.group(2) or "")

        title = None
        tm = TITLE_RE.search(seg)
        if tm and not tm.group(1).startswith("http"):
            title = tm.group(1).strip()
        if not title:
            tm2 = re.search(r">\s*([^<>]{8,120}?)\s*</(?:span|div|a)>", seg)
            title = tm2.group(1).strip() if tm2 else ""

        sm = SHOP_RE.search(seg)
        dm = SOLD_RE.search(seg)
        items.append({
            "id": iid,
            "title": title or "",
            "price": price,
            "shop": sm.group(1).strip() if sm else None,
            "sold": dm.group(1) if dm else None,
            "url": "https://item.taobao.com/item.htm?id=%s" % iid,
        })
    return items


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("keyword")
    ap.add_argument("--page", type=int, default=1)
    ap.add_argument("--limit", type=int, default=20)
    ap.add_argument("--json", action="store_true")
    a = ap.parse_args()

    html, final, status = fetch(a.keyword, a.page)
    if status != "ok" or not html:
        print(json.dumps({"ok": False, "error": "fetch_failed",
                          "status": status, "final": final}, ensure_ascii=False))
        return 1

    items = parse(html, a.limit)
    if a.json:
        print(json.dumps({
            "ok": True, "keyword": a.keyword, "page": a.page,
            "final": final, "bytes": len(html),
            "count": len(items), "items": items,
        }, ensure_ascii=False, indent=1))
    else:
        print("淘宝搜索：%s  第%d页  解析出 %d 条  (%d bytes)"
              % (a.keyword, a.page, len(items), len(html)))
        for n, it in enumerate(items, 1):
            print("%2d) ¥%-9s %s" % (n, it["price"] or "?", it["title"][:58]))
            extra = " ".join(x for x in (it["shop"], it["sold"]) if x)
            if extra:
                print("     %s" % extra)
    return 0


if __name__ == "__main__":
    sys.exit(main())
