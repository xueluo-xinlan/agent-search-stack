# -*- coding: utf-8 -*-
"""小红书第二探：移动 UA / 不同入口 / 短链。"""
import json, re, sys, time, urllib.parse, urllib.request
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
PORT = "8191"
MOBILE_UA = ("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 "
             "(KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1")
KW = urllib.parse.quote("储物架")
TESTS = [
    ("移动搜索", "https://www.xiaohongshu.com/search_result?keyword=%s&type=51" % KW, MOBILE_UA),
    ("搜索type54", "https://www.xiaohongshu.com/search_result?keyword=%s&type=54" % KW, None),
    ("web搜索source", "https://www.xiaohongshu.com/search_result?keyword=%s&source=web_explore_feed" % KW, None),
    ("移动explore", "https://www.xiaohongshu.com/explore", MOBILE_UA),
]
def fetch(url, ua=None):
    payload = {"cmd": "request.get", "url": url, "maxTimeout": 90000}
    if ua: payload["headers"] = {"User-Agent": ua}
    body = json.dumps(payload).encode()
    req = urllib.request.Request("http://127.0.0.1:%s/v1" % PORT, data=body,
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=180) as r:
        return json.loads(r.read().decode("utf-8", "replace"))
for name, u, ua in TESTS:
    try:
        d = fetch(u, ua); s = d.get("solution") or {}; h = s.get("response") or ""
        txt = re.sub(r'\s+', ' ', re.sub(r'<[^>]+>', ' ', h))
        # 找可能的笔记标题（小红书笔记卡里 title 属性）
        titles = re.findall(r'title="([^"]{6,60})"', h)
        has_empty = "search-empty" in h or "暂无" in h
        print("R|%s|status=%s|blocked=%s|len=%d|empty=%s|titles=%s" % (
            name, s.get("status"), s.get("blocked"), len(h), has_empty, titles[:6]), flush=True)
        if ua: print("   (移动UA)", flush=True)
    except Exception as e:
        print("R_FAIL|%s|%s" % (name, str(e)[:90]), flush=True)
    time.sleep(6)
print("XHS2_DONE")
