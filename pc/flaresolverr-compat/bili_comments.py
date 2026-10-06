# -*- coding: utf-8 -*-
"""抓取 B站高相关视频的简介 + 热门评论（真实玩家经验来源）。"""
import json, sys, time, urllib.request
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
UA = "curl/8.4.0"
D = r"C:\Users\you\flaresolverr_compat"

vids = {}
for f in (D + r"\_bili_out.json", D + r"\_bili_out2.json"):
    try:
        for r in json.load(open(f, encoding="utf-8")):
            b = r.get("bvid")
            if not b:
                continue
            d = vids.setdefault(b, {"bvid": b, "title": r.get("title"), "author": r.get("author"),
                                    "play": r.get("play") or 0, "aid": r.get("aid")})
            d["play"] = max(d["play"], r.get("play") or 0)
            if not d.get("aid"):
                d["aid"] = r.get("aid")
    except Exception as e:
        print("LOADFAIL|%s|%s" % (f, str(e)[:60]))
order = sorted(vids.values(), key=lambda x: -x["play"])
print("videos=%d" % len(order))


def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=25) as r:
        return json.loads(r.read().decode("utf-8", "replace"))


out = []
for v in order[:12]:
    aid = v.get("aid")
    if not aid:
        continue
    try:
        d = get("https://api.bilibili.com/x/web-interface/view?aid=%d" % aid)
        if d.get("code") == 0:
            vv = d["data"]
            v["desc"] = (vv.get("desc") or "")[:700]
            v["view"] = (vv.get("stat") or {}).get("view")
        time.sleep(6)
        d2 = get("https://api.bilibili.com/x/v2/reply?type=1&oid=%d&sort=2&ps=20&pn=1" % aid)
        cm = []
        if d2.get("code") == 0:
            for c in ((d2.get("data") or {}).get("replies") or []):
                cm.append({"msg": ((c.get("content") or {}).get("message") or "")[:400],
                           "like": c.get("like"), "rc": len(c.get("replies") or [])})
        else:
            print("REPLYCODE|%s|%s" % (v["bvid"], d2.get("code")))
        v["comments"] = cm
    except Exception as e:
        print("FAIL|%s|%s" % (v["bvid"], str(e)[:80]))
    time.sleep(5)
    out.append(v)
    print("OK|%s|%s|desc=%d|cm=%d" % (v["bvid"], (v.get("title") or "")[:36],
                                      len(v.get("desc") or ""), len(v.get("comments") or [])))

json.dump(out, open(D + r"\_bili_detail.json", "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print("DONE")
