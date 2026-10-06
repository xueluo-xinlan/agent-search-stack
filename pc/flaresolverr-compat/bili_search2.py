# -*- coding: utf-8 -*-
"""Bilibili 第二批搜索：补跑 412 失败的词 + 扩展词；长间隔重试。"""
import html
import json
import re
import sys
import time
import urllib.parse
import urllib.request

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

UA = "curl/8.4.0"
KWS = [
    "\u624b\u529e\u67dc \u907f\u5751",              # 储物架 避坑
    "\u624b\u529e \u5c55\u793a\u67dc \u63a8\u8350",   # 模型 展示架 推荐
    "\u624b\u529e\u67dc \u5c3a\u5bf8",              # 储物架 尺寸
    "\u4e9a\u514b\u529b \u624b\u529e\u67dc",         # 亚克力 储物架
    "\u624b\u529e\u67dc \u5b9a\u5236",              # 储物架 定制
    "\u6a21\u578b\u67dc \u63a8\u8350",              # 模型架 推荐
]
OUT = []
TAG = re.compile(r"<[^>]+>")


def clean(s):
    return html.unescape(TAG.sub("", s or "")).strip()


def fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=25) as r:
        return json.loads(r.read().decode("utf-8", "replace"))


def search(kw, tries=3):
    q = urllib.parse.quote(kw)
    url = ("https://api.bilibili.com/x/web-interface/search/type"
           "?search_type=video&keyword=%s&page=1&order=totalrank" % q)
    for i in range(tries):
        try:
            d = fetch(url)
        except Exception as e:
            print("RETRY|%s|%s|%s" % (kw, i, str(e)[:70]))
            time.sleep(22)
            continue
        if d.get("code") == 0:
            return d
        print("CODE|%s|%s|%s" % (kw, i, str(d.get("message"))[:70]))
        time.sleep(22)
    return None


for kw in KWS:
    d = search(kw)
    if not d:
        print("KW_FAIL|%s" % kw)
        time.sleep(20)
        continue
    res = (d.get("data") or {}).get("result") or []
    print("KW_OK|%s|n=%d" % (kw, len(res)))
    for it in res[:12]:
        t = clean(it.get("title"))
        rec = {
            "kw": kw, "bvid": it.get("bvid"), "aid": it.get("aid"), "title": t,
            "author": it.get("author"), "mid": it.get("mid"), "play": it.get("play"),
            "favorites": it.get("favorites"), "pubdate": it.get("pubdate"),
            "duration": it.get("duration"), "desc": clean(it.get("description"))[:300],
        }
        OUT.append(rec)
        print("%s|%s|%s|%s|%s|%s|%s" % (kw, rec["bvid"], rec["play"], rec["favorites"],
                                        rec["pubdate"], rec["author"], t[:80]))
    time.sleep(20)

with open(r"C:\Users\you\flaresolverr_compat\_bili_out2.json", "w", encoding="utf-8") as f:
    json.dump(OUT, f, ensure_ascii=False, indent=1)
print("TOTAL2=%d" % len(OUT))
print("DONE2")
