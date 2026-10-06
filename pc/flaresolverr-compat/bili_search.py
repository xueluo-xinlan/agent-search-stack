# -*- coding: utf-8 -*-
"""Bilibili 关键词搜索采集（源码纯 ASCII，中文用 \\u 转义）。
用法: python bili_search.py
输出: 逐行 kw|bvid|play|pubdate|author|title；完整 JSON 落盘 _bili_out.json
"""
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
    "\u624b\u529e\u67dc \u63a8\u8350",       # 储物架 推荐
    "\u624b\u529e\u67dc \u907f\u5751",       # 储物架 避坑
    "\u624b\u529e \u5c55\u793a\u67dc \u63a8\u8350",  # 模型 展示架 推荐
    "\u624b\u529e\u67dc \u5c3a\u5bf8",       # 储物架 尺寸
    "\u9ad8\u8fbe \u5c55\u793a\u67dc",       # 高达 展示架
    "\u4e9a\u514b\u529b \u624b\u529e\u67dc",  # 亚克力 储物架
]
OUT = []
TAG = re.compile(r"<[^>]+>")


def clean(s):
    return html.unescape(TAG.sub("", s or "")).strip()


def fetch(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=25) as r:
        return json.loads(r.read().decode("utf-8", "replace"))


for kw in KWS:
    q = urllib.parse.quote(kw)
    url = ("https://api.bilibili.com/x/web-interface/search/type"
           "?search_type=video&keyword=%s&page=1&order=totalrank" % q)
    try:
        d = fetch(url)
    except Exception as e:
        print("KW_FAIL|%s|%s" % (kw, str(e)[:90]))
        time.sleep(4)
        continue
    code = d.get("code")
    if code != 0:
        print("KW_CODE|%s|code=%s|msg=%s" % (kw, code, str(d.get("message"))[:80]))
        time.sleep(4)
        continue
    res = (d.get("data") or {}).get("result") or []
    print("KW_OK|%s|n=%d" % (kw, len(res)))
    for it in res[:15]:
        t = clean(it.get("title"))
        rec = {
            "kw": kw,
            "bvid": it.get("bvid"),
            "aid": it.get("aid"),
            "title": t,
            "author": it.get("author"),
            "mid": it.get("mid"),
            "play": it.get("play"),
            "danmaku": it.get("video_review"),
            "favorites": it.get("favorites"),
            "pubdate": it.get("pubdate"),
            "duration": it.get("duration"),
            "desc": clean(it.get("description"))[:300],
        }
        OUT.append(rec)
        print("%s|%s|%s|%s|%s|%s" % (kw, rec["bvid"], rec["play"], rec["pubdate"], rec["author"], t[:90]))
    time.sleep(4)

with open(r"C:\Users\you\flaresolverr_compat\_bili_out.json", "w", encoding="utf-8") as f:
    json.dump(OUT, f, ensure_ascii=False, indent=1)
print("TOTAL=%d" % len(OUT))
print("DONE")
