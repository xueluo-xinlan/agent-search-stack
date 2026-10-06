# -*- coding: utf-8 -*-
"""小红书探针：搜索页 + 笔记页，走抓取层。"""
import json, re, sys, time, urllib.parse, urllib.request
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
PORT = "8191"
URLS = [
    ("搜索页", "https://www.xiaohongshu.com/search_result?keyword=" + urllib.parse.quote("储物架")),
    ("搜索页2", "https://www.xiaohongshu.com/search_result?keyword=" + urllib.parse.quote("储物架 尺寸")),
    ("探索页", "https://www.xiaohongshu.com/explore"),
]
def fetch(url):
    body = json.dumps({"cmd": "request.get", "url": url, "maxTimeout": 90000}).encode()
    req = urllib.request.Request("http://127.0.0.1:%s/v1" % PORT, data=body,
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=180) as r:
        return json.loads(r.read().decode("utf-8", "replace"))
for name, u in URLS:
    try:
        d = fetch(u); s = d.get("solution") or {}; h = s.get("response") or ""
        fin = s.get("url") or ""
        # 小红书笔记标题特征
        print("R|%s|status=%s|blocked=%s|kind=%s|final=%s|len=%d|note_cards=%d|login_kw=%s" % (
            name, s.get("status"), s.get("blocked"), s.get("blockedKind"), fin[:56], len(h),
            h.count("note-item") + h.count("feeds-page"), ("登录" in h) or ("login" in fin)), flush=True)
        # 正文片段
        txt = re.sub(r'<[^>]+>', ' ', h)
        txt = re.sub(r'\s+', ' ', txt)
        i = txt.find("模型")
        if i > 0:
            print("    片段: " + txt[max(0,i-100):i+300], flush=True)
    except Exception as e:
        print("R_FAIL|%s|%s" % (name, str(e)[:100]), flush=True)
    time.sleep(6)
print("XHS_DONE")
