# -*- coding: utf-8 -*-
"""验证 + 补搜：① 关键命中的尺寸上下文 ② 定向搜矮柜。"""
import json, re, sys, time, urllib.parse, urllib.request
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
PORT = "8192"
DIM3 = re.compile(r'(\d{2,4})\s*[*xX×]\s*(\d{2,4})\s*[*xX×]\s*(\d{2,4})')
ID_RE = re.compile(r'(?:item\.taobao\.com|detail\.tmall\.com)/item\.htm\?id=(\d+)')
T_RE = re.compile(r'class="[^"]*title--[^"]*"[^>]*>(.*?)</div>', re.S)
P_RE = re.compile(r'priceInt--[^"]*">(\d+)</div><div class="[^"]*priceFloat--[^"]*">([\d.]*)</div>')

def fetch(url):
    body = json.dumps({"cmd": "request.get", "url": url, "maxTimeout": 90000}).encode()
    req = urllib.request.Request("http://127.0.0.1:%s/v1" % PORT, data=body,
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=180) as r:
        return json.loads(r.read().decode("utf-8", "replace"))

def text(s):
    return re.sub(r'<[^>]+>', ' ', s)

# ① 验证关键命中
print("=== ① 验证 1075696814171 的尺寸上下文 ===", flush=True)
d = fetch("https://item.taobao.com/item.htm?id=1075696814171")
h = (d.get("solution") or {}).get("response") or ""
t = text(h)
print("页面 %d bytes, 纯文本 %d 字" % (len(h), len(t)))
for m in DIM3.finditer(t):
    ctx = t[max(0, m.start()-120):m.end()+120]
    ctx = re.sub(r'\s+', ' ', ctx)
    print("  ★ %s  <<< %s" % (m.group(0), ctx[:240]))
print("  --- '规格' 关键词附近 ---")
for kw in ('规格', '长', '宽', '高', '尺寸'):
    for m in list(re.finditer(kw, t))[:3]:
        seg = re.sub(r'\s+', ' ', t[max(0,m.start()-60):m.start()+160])
        print("  [%s] %s" % (kw, seg[:190]))
time.sleep(6)

# ② 定向搜矮柜
print("\n=== ② 定向搜「70 40 65」类矮柜 ===", flush=True)
for kw in ("展示架 70*40*65", "矮柜 70宽 65高 玻璃", "储物架 矮 70cm"):
    u = "https://s.taobao.com/search?q=" + urllib.parse.quote(kw)
    d = fetch(u); h = (d.get("solution") or {}).get("response") or ""
    seen = set()
    print("KW=%s bytes=%d" % (kw, len(h)), flush=True)
    for m in ID_RE.finditer(h):
        iid = m.group(1)
        if iid in seen: continue
        seen.add(iid)
        seg = h[max(0, m.start()-4000):m.start()+7000]
        tt = T_RE.search(seg)
        title = re.sub(r'<[^>]+>', '', tt.group(1)).strip() if tt else ""
        if len(title) < 6: continue
        p = P_RE.search(seg)
        print("   %s | ¥%s | %s" % (iid, (p.group(1)+(p.group(2) or "")) if p else "?", title[:64]))
    time.sleep(7)
print("VERIFY_DONE")
