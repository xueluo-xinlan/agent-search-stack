# -*- coding: utf-8 -*-
"""B站深度采集：视频详情(标题/简介/分P) + 热度评论前 20 条。UA=curl/8.4.0。"""
import json, sys, time, urllib.request
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
UA = "curl/8.4.0"
BVS = ["BV1LmtH6ZEX5","BV1Bx4y1r7GS","BV1d9UBYcECm","BV1JpkgBiEq2","BV1t7frYUEaF",
       "BV1vG41147Hb","BV1v64y1s7GU","BV1Jv4y1e7nc","BV19Ljh6nEDS","BV1pyNweJEqG",
       "BV1iE411b76c","BV1MvN2zCECw","BV1oq421A7Hr","BV1s2m4YVEJx","BV1ms411u7SF",
       "BV1dY4y1U7Yr","BV1RW411d79G"]

def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=25) as r:
        return json.loads(r.read().decode("utf-8", "replace"))

OUT = []
for bv in BVS:
    rec = {"bvid": bv}
    try:
        d = get("https://api.bilibili.com/x/web-interface/view?bvid=" + bv).get("data") or {}
        rec.update({"title": d.get("title"), "aid": d.get("aid"),
                    "owner": (d.get("owner") or {}).get("name"),
                    "desc": (d.get("desc") or "")[:600],
                    "view": (d.get("stat") or {}).get("view"),
                    "like": (d.get("stat") or {}).get("like"),
                    "pubdate": d.get("pubdate"), "pages": d.get("videos")})
    except Exception as e:
        print("VIEW_FAIL|%s|%s" % (bv, str(e)[:80])); OUT.append(rec); time.sleep(3.5); continue
    time.sleep(3.5)
    aid = rec.get("aid")
    cmts = []
    if aid:
        try:
            c = get("https://api.bilibili.com/x/v2/reply?type=1&oid=%d&sort=2&ps=20&pn=1" % aid)
            for r in ((c.get("data") or {}).get("replies") or []):
                cmts.append({"u": (r.get("member") or {}).get("uname"),
                             "m": (r.get("content") or {}).get("message", "")[:300],
                             "like": r.get("like")})
        except Exception as e:
            print("CMT_FAIL|%s|%s" % (bv, str(e)[:70]))
    rec["comments"] = cmts
    OUT.append(rec)
    print("OK|%s|%s|cm=%d|view=%s" % (bv, (rec.get("title") or "")[:40], len(cmts), rec.get("view")))
    time.sleep(3.5)

json.dump(OUT, open(r"C:\Users\you\flaresolverr_compat\_bili_deep.json", "w", encoding="utf-8"),
          ensure_ascii=False, indent=1)
print("DONE n=%d" % len(OUT))
