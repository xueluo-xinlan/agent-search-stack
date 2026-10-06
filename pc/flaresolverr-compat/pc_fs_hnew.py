#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""FlareSolverr 兼容层（v1.1：持久化 profile + 同站限速）。

相对 v1.0 的三处改动（全部可用命令行参数覆盖/关闭）：

  1) 持久化浏览器 profile（--profile-dir，默认 脚本同目录/browser_profile）
     由 new_context() 改为 launch_persistent_context()，cookie / localStorage
     落盘，重启后继续复用。这是"人工过了一次验证就能长期免验证"的前提：
     实测同一个贴吧 URL，常驻实例（有已通过的 cookie）能读出内容，全新
     上下文（零 cookie）会被甩滑动拼图 —— 差别只在 cookie。

  2) 同站限速（--min-host-gap 1.2s / --min-global-gap 0.35s / --jitter 0.8s）
     同一 host 的连续请求强制拉开间隔并加随机抖动。实测日志里出现过
     "一秒内 8 个请求全打向同一站"的突发，限速用来消除这种自己制造的尖峰。
     注意：限速只能消除突发，不改变"通道被判定为自动化"这一根因。

  3) /health 增加 profile 目录与 cookie 计数，便于确认持久化是否生效。

  4) 登录页 / 风控页不再被当成正文（BLOCKED_DOMAINS / BLOCKED_PATHS）
     请求 URL 命中 -> 不打开浏览器直接返回提示；导航后落点命中 -> 不提取其
     内容。两者都以 status:"ok" 返回一段明确说明，理由：网关在 FlareSolverr
     失败时会转入 playwright 兜底，用报错实现"跳过"反而会多抓一次。
     提示正文里带机器可读信号 [BLOCKED kind=… reason=…]，响应 solution 里同步
     给出 blocked / blockedKind 两个字段。kind 分两类：login-wall（未登录所致，
     补登录态 cookie 有可能解开）与 risk-control（服务端风控判定，补 cookie
     也可能无效）。拦截行的日志统一为 ok(blocked)，与真实成功抓取一眼可分。

  5) 内嵌结构化数据提取（_embedded_block）：meta / JSON-LD / 知名 SSR 变量 /
     通用键名四类并行，附加在 HTML 末尾的 <pre> 里，让消费端拿到结构化字段，
     而不是被 htmlToMarkdown 洗掉之后的纯文本。
  6) 正文型登录墙嗅探（_looks_like_login_wall）：返回 200 且不跳转、正文却写
     着"请登录"的站，只挂 suspectedWall 标记，不拦截（拦了误伤面太大）。
  7) 按域统计（_HOST_STATS，/health 的 byHost）+ 导航后延时随机化（±400ms）
     + 失败退避 1.5-3.5s 后再重试。

原 v1.0 的健壮性修复全部保留（_full_reset 的循环中毒处理、browserReady
作为唯一存活判据、pythonw 下不依赖 stdout 的日志）。

用法（PC）：python pc_flaresolverr_compat.py [--port 8191] [--headless]
"""
from __future__ import annotations

import argparse
import json
import os
import random
import re
import sys
import threading
import time
import traceback
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import urlparse

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

VERSION = "1.2.1-hnew-test"
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
PROFILE_DIR = os.path.join(BASE_DIR, "browser_profile_hnew")

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0")
ARGS = [
    "--disable-blink-features=AutomationControlled",
    "--disable-dev-shm-usage",
    "--no-first-run",
    "--no-default-browser-check",
    # 有头模式下把窗口挪出可视区域，避免占用桌面（headless 下无副作用）
    "--window-position=-32000,-32000",
    "--headless=new",
]

# ---- 登录页 / 风控页识别（用户批准的第四项改动）----
# 目的：兼容层此前会跟随跳转去抓 login.taobao.com / plogin.m.jd.com /
# pc-frequent-pro.pf.jd.com 这类页面，既白费一次浏览器访问，也让网关把
# "请登录"页当成正文返回。现在改为：
#   · 请求 URL 本身就落在这些域/路径 -> 直接返回提示，不打开浏览器
#   · 导航后最终落点落在这些域/路径 -> 返回提示，不提取其内容
# 两种情况都以 status:"ok" 返回。原因见网关 src/fetch/service.ts 第 115-129 行：
# FlareSolverr 一旦返回失败，网关会再走 playwright 兜底（等于多抓一次），
# 所以这里不能用报错来实现"跳过"。
BLOCKED_DOMAINS = {
    "login.taobao.com": "login-wall",
    "passport.jd.com": "login-wall",
    "plogin.m.jd.com": "login-wall",
    ".pf.jd.com": "risk-control",
    "login.1688.com": "login-wall",
    "passport.suning.com": "login-wall",
    "login.suning.com": "login-wall",
    "passport.yangkeduo.com": "login-wall",
    "login.xiaohongshu.com": "login-wall",
    "login.smzdm.com": "login-wall",
    "cfe.m.jd.com": "risk-control",
}
BLOCKED_PATHS = {
    "/login": "login-wall",
    "/signin": "login-wall",
    "/passport": "login-wall",
    "/captcha": "risk-control",
    "/privatedomain/risk_handler": "risk-control",
}
BLOCK_NOTICE = (
    "<html><head><title>\u5df2\u8df3\u8fc7\uff1a\u767b\u5f55/\u98ce\u63a7\u9875</title>"
    "<meta name=\"hermes-blocked\" content=\"%(kind)s|%(reason)s\"></head><body>"
    "<h1>\u5df2\u8df3\u8fc7\uff1a\u767b\u5f55\u9875 / \u98ce\u63a7\u9875</h1>"
    "<p>[BLOCKED kind=%(kind)s reason=%(reason)s]</p>"
    "<p>\u6700\u7ec8\u843d\u70b9\u547d\u4e2d\u767b\u5f55\u6216\u98ce\u63a7\u57df\u540d\u3001"
    "\u8def\u5f84\uff0c\u517c\u5bb9\u5c42\u5df2\u6309\u7b56\u7565\u8df3\u8fc7\u5185\u5bb9\u63d0\u53d6\u3002</p>"
    "<p>\u8bf7\u52ff\u5c06\u672c\u7ed3\u679c\u5f53\u4f5c\u9875\u9762\u6b63\u6587\u3002"
    "\u9700\u8981\u771f\u5b9e\u5185\u5bb9\uff0c\u8bf7\u5148\u8fd0\u884c verify_cookies.bat "
    "\u4eba\u5de5\u8fc7\u4e00\u6b21\u9a8c\u8bc1/\u767b\u5f55\u540e\u518d\u8bd5\u3002</p>"
    "<p>final_url=%(final)s</p></body></html>"
)


def _blocked_info(u: str):
    """命中登录/风控域或路径则返回 (reason, kind)，否则 (None, None)。

    两部分含义不同，消费端据此判断可救性：
      login-wall   —— 未登录/无凭据所致，补上登录态 cookie 有可能解开
      risk-control —— 服务端风控判定（IP 信誉、指纹、频次），补 cookie 也可能无效
    """
    p = urlparse(u)
    host = (p.netloc or "").lower().split(":")[0]
    path = (p.path or "").lower()
    for suf, kind in BLOCKED_DOMAINS.items():
        s = suf[1:] if suf.startswith(".") else suf
        if host == s or host.endswith("." + s):
            return "host:" + host, kind
    for pre, kind in BLOCKED_PATHS.items():
        if path.startswith(pre):
            return "path:" + path, kind
    return None, None


# ---- 按域统计：总计数回答不了"哪些站真能抓"，这个问题只能按 host 分开算 ----
_HOST_STATS = {}


def _host_of(u: str) -> str:
    return (urlparse(u).netloc or "").lower().split(":")[0]


def _bump(host: str, key: str) -> None:
    if not host:
        return
    d = _HOST_STATS.setdefault(host, {"ok": 0, "blocked": 0, "fail": 0})
    d[key] = d.get(key, 0) + 1


# ---- 页面内嵌结构化数据提取 ----
# 背景：网关只取 solution.response（经 htmlToMarkdown），页面里的结构化字段
# 在转换中全被丢弃，agent 只能拿到纯文本。这里挑出可通用的四类信号，附在
# HTML 末尾的 <pre> 里（转 markdown 后保留为代码块）。
# 实测教训（2026-10 京东 H5 页）：application/ld+json 数量为 0，
# __NEXT_DATA__ / __NUXT__ / __INITIAL_STATE__ / __APOLLO_STATE__ /
# __PRELOADED_STATE__ 一个都不存在。所以"只抓知名 SSR 变量"会全落空，
# 必须四类并行才能覆盖不同站点。
EMBED_META_KEEP = (
    "og:title", "og:description", "og:image", "og:type", "og:site_name",
    "twitter:title", "twitter:description", "description", "keywords",
    "product:price:amount", "product:price:currency",
)
EMBED_SSR = (
    ("__NEXT_DATA__", r'<script[^>]*id=["\']__NEXT_DATA__["\'][^>]*>(.*?)</script>'),
    ("__NUXT__", r'window\.__NUXT__\s*=\s*(\{.{0,20000}?\})\s*;?\s*</script>'),
    ("__INITIAL_STATE__", r'window\.__INITIAL_STATE__\s*=\s*(\{.{0,20000}?\})\s*;'),
    ("__APOLLO_STATE__", r'window\.__APOLLO_STATE__\s*=\s*(\{.{0,20000}?\})\s*;'),
    ("__PRELOADED_STATE__", r'window\.__PRELOADED_STATE__\s*=\s*(\{.{0,20000}?\})\s*;'),
)
EMBED_KEY_RE = re.compile(
    r'"(skuName|productName|itemName|brandName|venderId|shopName|skuId|productId|'
    r'itemId|price|jdPrice|salePrice|currentPrice|originalPrice)"\s*:\s*"([^"]{1,160})"')
EMBED_BUDGET = 40000


def _embedded_block(html: str) -> str:
    """抽取 meta / JSON-LD / 知名 SSR 变量 / 通用键名，拼成末尾附加块。"""
    parts = []

    metas = []
    for m in re.finditer(
            r'<meta[^>]+(?:property|name)=["\']([^"\']+)["\'][^>]*content=["\']([^"\']*)["\']',
            html, re.I):
        k = m.group(1).strip().lower()
        if k in EMBED_META_KEEP and m.group(2).strip():
            metas.append("%s = %s" % (k, m.group(2).strip()[:300]))
    if metas:
        parts.append(("meta", "\n".join(dict.fromkeys(metas))))

    for m in re.finditer(
            r'<script[^>]*type=["\']application/ld\+json["\'][^>]*>(.*?)</script>',
            html, re.S | re.I):
        s = m.group(1).strip()
        if len(s) >= 40:
            parts.append(("ld+json", s[:15000]))
            break

    for name, pat in EMBED_SSR:
        m = re.search(pat, html, re.S | re.I)
        if m and len(m.group(1).strip()) >= 40:
            parts.append((name, m.group(1).strip()[:15000]))

    kv, seen = [], set()
    for m in EMBED_KEY_RE.finditer(html):
        k, v = m.group(1), m.group(2)
        if v and (k, v) not in seen:
            seen.add((k, v))
            kv.append("%s = %s" % (k, v))
        if len(kv) >= 25:
            break
    if kv:
        parts.append(("key-fields", "\n".join(kv)))

    if not parts:
        return ""

    buf = ['\n<pre data-hermes-embedded="1">[EMBEDDED DATA]\n']
    used = 0
    for name, body in parts:
        if used >= EMBED_BUDGET:
            break
        chunk = "--- %s ---\n%s\n" % (name, body[:EMBED_BUDGET - used])
        used += len(chunk)
        buf.append(chunk)
    buf.append("</pre>\n")
    return "".join(buf)


# ---- 正文型登录墙嗅探（只标记，不拦截）----
# 跳转型登录墙由 BLOCKED_DOMAINS / BLOCKED_PATHS 处理。但有些站点返回 200
# 且不跳转，正文里直接写"请登录"。这类不能拦（误伤面大），只在响应里挂
# 一个 suspectedWall 字段，把判断权交给消费端。
LOGIN_HINTS = ("请登录", "登录查看价格", "亲，请登录", "扫码登录")


def _looks_like_login_wall(status: int, html: str):
    if status != 200 or len(html) > 120000:
        return None
    for hint in LOGIN_HINTS:
        if hint in html:
            return hint
    return None


_pw = None
_browser = None
_context = None
# 模块级默认；main() 会用 --headless 的取值覆盖它。默认有头：headless 的指纹
# 特征更明显，且硬传 --headless 会让本文件的 help 文案与启动脚本互相打架。
HEADLESS = False

# ---- 限速参数（命令行可覆盖）----
MIN_HOST_GAP = 1.2      # 同一 host 两次请求的最小间隔（秒）
SETTLE_MS = 1200        # 导航后等待页面稳定的基线毫秒数
SETTLE_JITTER_MS = 400  # 基线之上叠加的随机抖动（±），避免固定值本身成为特征
MIN_GLOBAL_GAP = 0.35   # 任意两次请求的最小间隔（秒）
JITTER = 0.8            # 在上述间隔之上叠加 0~JITTER 秒随机抖动
_last_host: dict = {}
_last_global = [0.0]

_STATS = {"oks": 0, "fails": 0, "failStreak": 0, "lastError": "", "lastErrorAt": "",
          "lastOkAt": "", "throttled": 0, "lastCookies": 0,
          "blockedRequests": 0, "blockedRedirects": 0}


LOG_PATH = os.path.join(BASE_DIR, "flaresolverr_compat_hnew.log")


def log(msg: str) -> None:
    """写同目录日志文件（不依赖 stdout：pythonw 下 stdout 为 None）。"""
    line = "[%s] %s" % (time.strftime("%Y-%m-%d %H:%M:%S"), msg)
    try:
        with open(LOG_PATH, "a", encoding="utf-8") as fh:
            fh.write(line + "\n")
    except Exception:
        pass
    try:
        if sys.stdout is not None:
            print(line, flush=True)
    except Exception:
        pass


def _throttle(url: str) -> float:
    """同 host + 全局双重最小间隔，附加随机抖动。返回实际等待秒数。

    单线程 HTTTServer 串行处理，故无需加锁。
    """
    host = (urlparse(url).netloc or "").lower()
    now = time.time()
    wait = 0.0
    if now - _last_global[0] < MIN_GLOBAL_GAP:
        wait = max(wait, MIN_GLOBAL_GAP - (now - _last_global[0]))
    prev = _last_host.get(host)
    if prev is not None and now - prev < MIN_HOST_GAP:
        wait = max(wait, MIN_HOST_GAP - (now - prev))
    if wait > 0:
        wait += random.uniform(0, JITTER)
        _STATS["throttled"] += 1
        log("throttle %.2fs host=%s" % (wait, host or "?"))
        time.sleep(wait)
    return wait


def _mark_done(url: str) -> None:
    """请求处理结束后打点（限速的时间戳必须记在这里，不能记在开始处）。

    兼容层是单线程串行处理：若按"请求开始"打点，两个请求的开始间隔恒等于
    前一个请求的处理耗时（实测中位 5.87s），MIN_HOST_GAP 永远达不到，限速
    形同虚设。只有记"结束"时刻，才能在串行队列里真正插入间隔。
    """
    t = time.time()
    _last_global[0] = t
    host = (urlparse(url).netloc or "").lower()
    if host:
        _last_host[host] = t


def _ensure_context():
    """惰性拉起常驻浏览器上下文（首次请求时构造，之后复用）。

    v1.1：改用 launch_persistent_context，profile 落盘到 PROFILE_DIR。
    注意与 v1.0 的差异 —— 持久化上下文本身就是 context，没有独立的
    browser 对象，因此 _browser 保持 None，_full_reset 中已按 None 处理。
    """
    global _pw, _browser, _context
    if _context is not None:
        return _context
    from playwright.sync_api import sync_playwright

    try:
        os.makedirs(PROFILE_DIR, exist_ok=True)
    except Exception as e:
        log("mkdir profile failed (%s); using default profile path" % e)

    _pw = sync_playwright().start()
    kwargs = dict(
        user_data_dir=PROFILE_DIR,
        headless=HEADLESS,
        args=ARGS,
        user_agent=UA,
        locale="zh-CN",
        viewport={"width": 1366, "height": 900},
        ignore_https_errors=True,
    )
    try:
        _context = _pw.chromium.launch_persistent_context(channel="msedge", **kwargs)
        log("persistent context via system Edge; profile=%s" % PROFILE_DIR)
    except Exception as e:
        log("msedge channel failed (%s); falling back to bundled chromium" % e)
        _context = _pw.chromium.launch_persistent_context(**kwargs)
    _context.add_init_script(
        "Object.defineProperty(navigator,'webdriver',{get:()=>undefined});"
    )
    _browser = None
    try:
        n = len(_context.cookies())
        _STATS["lastCookies"] = n
        log("profile cookie count at launch: %d" % n)
    except Exception:
        pass
    return _context


def _drop_context() -> None:
    global _context
    try:
        if _context is not None:
            _context.close()
    except Exception:
        pass
    _context = None


def _full_reset() -> None:
    """彻底重置 context / browser / playwright 实例。

    背景（实测教训）：单次导航失败（如 net::ERR_CONNECTION_CLOSED）后，只调用
    _drop_context() 会把已损坏的 playwright 实例留在全局里，后续每个请求都会抛
    "It looks like you are using Playwright Sync API inside the asyncio loop"，
    浏览器从此永久不可用（/health 的 browserReady 一直是 false），而看护脚本
    只看端口是否监听，永远不会重启它。所以致命错误必须连 _pw 一起丢掉，让下
    一次请求从头重建整套环境。

    v1.1：持久化上下文下 _browser 恒为 None，这里按 None 跳过即可；profile
    目录保留在磁盘上，重建后 cookie 依然在，这正是持久化要的效果。
    """
    global _pw, _browser, _context
    try:
        if _context is not None:
            _context.close()
    except Exception:
        pass
    try:
        if _browser is not None:
            _browser.close()
    except Exception:
        pass
    try:
        if _pw is not None:
            _pw.stop()
    except Exception:
        pass
    _context = None
    _browser = None
    _pw = None


_LOOP_POISON = ("asyncio loop", "Sync API inside", "Target page, context or browser has been closed",
                "Browser has been closed", "Connection closed")


def _is_fatal(err: Exception) -> bool:
    """判定是否属于必须完整重建环境的致命错误。"""
    msg = str(err)
    return any(k in msg for k in _LOOP_POISON)


def do_request_get(url: str, timeout_ms: int, _retry: bool = True):
    host = _host_of(url)
    try:
        return _attempt_get(url, timeout_ms)
    except Exception as e:
        _bump(host, "fail")
        if _retry:
            # 致命错误（浏览器/循环已脏）→ 退避后完整重建再试一次，避免整个服务残废。
            # 退避是必须的：立刻重试等于对被判定为异常的请求再打一次，只会加深风控印象。
            backoff = round(random.uniform(1.5, 3.5), 2)
            log("attempt failed (%s); backoff %.2fs, full reset, retry once"
                % (str(e)[:160], backoff))
            time.sleep(backoff)
            _full_reset()
            try:
                return _attempt_get(url, timeout_ms)
            except Exception as e2:
                _full_reset()
                raise e2
        _full_reset()
        raise


def _attempt_get(url: str, timeout_ms: int):
    _throttle(url)
    ctx = _ensure_context()
    page = ctx.new_page()
    host = _host_of(url)
    try:
        resp = page.goto(url, wait_until="domcontentloaded", timeout=timeout_ms)
        # 给 JS 挑战/重定向留出时间：等到网络静默或最多再等 6 秒
        try:
            page.wait_for_load_state("networkidle", timeout=6000)
        except Exception:
            pass
        # 固定延时本身是可识别特征：在基线上加抖动
        page.wait_for_timeout(
            int(SETTLE_MS + random.uniform(-SETTLE_JITTER_MS, SETTLE_JITTER_MS)))
        final = page.url
        status = resp.status if resp is not None else 200
        cookies = []
        try:
            for c in ctx.cookies():
                cookies.append({"name": c.get("name"), "value": c.get("value"),
                                "domain": c.get("domain"), "path": c.get("path"),
                                "expires": c.get("expires"), "httpOnly": c.get("httpOnly"),
                                "secure": c.get("secure"), "sameSite": c.get("sameSite")})
        except Exception:
            pass
        _STATS["lastCookies"] = len(cookies)

        # 跳转落点若是登录/风控页：不提取其内容，改返回明确提示（status 仍为 ok，
        # 理由见文件顶部 BLOCKED_DOMAINS 处注释：返回失败会触发网关的 playwright 兜底）
        reason, kind = _blocked_info(final)
        if kind:
            _STATS["blockedRedirects"] += 1
            _bump(host, "blocked")
            # 落点 URL 可能带上千字符的签名参数（淘宝 redirectURL 实测 1400+），
            # 全量灌进日志会淹没真正有用的行；留头部足以判定。
            log("blocked-redirect %s -> %s (%s, kind=%s)"
                % (url, final[:160] + ("..." if len(final) > 160 else ""), reason, kind))
            return {
                "url": final,
                "status": status,
                "headers": {},
                "response": BLOCK_NOTICE % {"kind": kind, "reason": reason, "final": final},
                "cookies": cookies,
                "userAgent": UA,
                "blocked": reason,
                "blockedKind": kind,
            }

        html = page.content()
        emb = _embedded_block(html)
        if emb:
            html = html + emb
        wall = _looks_like_login_wall(status, html)
        _bump(host, "ok")
        sol = {
            "url": final,
            "status": status,
            "headers": {},
            "response": html,
            "cookies": cookies,
            "userAgent": UA,
        }
        if emb:
            log("embedded-data %s (+%d chars)" % (url, len(emb)))
        if wall:
            sol["suspectedWall"] = wall
            log("suspected-login-wall %s (hint=%s)" % (url, wall))
        return sol
    finally:
        _mark_done(url)
        try:
            page.close()
        except Exception:
            pass


class Handler(BaseHTTPRequestHandler):
    server_version = "FlareSolverrCompat/" + VERSION

    def _send(self, code: int, payload: dict) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):  # noqa: N802
        if self.path.rstrip("/") in ("/health", ""):
            # 判定服务是否真的可用的唯一可靠信号：browserReady。
            # （看护脚本只看端口是否监听会在"端口活着、浏览器死了"时漏判，实测踩过。）
            hosts = sorted(_HOST_STATS.items(),
                           key=lambda kv: -(kv[1]["ok"] + kv[1]["blocked"] + kv[1]["fail"]))
            extra = {"profile": PROFILE_DIR,
                     "profileExists": os.path.isdir(PROFILE_DIR),
                     "rate": {"minHostGap": MIN_HOST_GAP, "minGlobalGap": MIN_GLOBAL_GAP,
                              "jitter": JITTER, "settleMs": SETTLE_MS,
                              "settleJitterMs": SETTLE_JITTER_MS},
                     "byHost": dict(hosts[:25])}
            extra.update(dict(_STATS))
            return self._send(200, {"status": "ok", "version": VERSION,
                                    "browserReady": _context is not None,
                                    "stats": extra})
        return self._send(404, {"status": "error", "message": "not found"})

    def do_POST(self):  # noqa: N802
        if self.path.rstrip("/") != "/v1":
            return self._send(404, {"status": "error", "message": "not found"})
        try:
            n = int(self.headers.get("Content-Length") or 0)
            payload = json.loads(self.rfile.read(n).decode("utf-8", "ignore") or "{}")
        except Exception as e:
            return self._send(400, {"status": "error", "message": "bad json: %s" % e})

        cmd = (payload.get("cmd") or "").strip()
        start = time.time()

        # 会话类命令：本实现用常驻上下文，直接应答 ok，保持 API 兼容
        if cmd.startswith("sessions."):
            sid = payload.get("session") or "default"
            if cmd == "sessions.create":
                return self._send(200, {"status": "ok", "message": "session created",
                                        "session": sid, "version": VERSION})
            if cmd == "sessions.destroy":
                _drop_context()
                return self._send(200, {"status": "ok", "message": "session destroyed",
                                        "version": VERSION})
            return self._send(200, {"status": "ok", "message": "ok", "session": sid})

        if cmd not in ("request.get", "request.post"):
            return self._send(200, {"status": "error", "message": "unsupported cmd: %s" % cmd,
                                    "solution": {}, "version": VERSION})

        url = (payload.get("url") or "").strip()
        if not url:
            return self._send(200, {"status": "error", "message": "url is required",
                                    "solution": {}, "version": VERSION})

        # 请求 URL 本身即登录/风控页：直接返回提示，不花一次浏览器访问。
        # 仍以 status:"ok" 返回，避免触发网关的 playwright 兜底与重试。
        pre, pre_kind = _blocked_info(url)
        if pre_kind:
            _STATS["blockedRequests"] += 1
            _bump(_host_of(url), "blocked")
            _STATS["lastOkAt"] = time.strftime("%Y-%m-%d %H:%M:%S")
            log("ok(blocked) %s -> %s (skip-blocked-request %s, kind=%s)"
                % (cmd, url, pre, pre_kind))
            return self._send(200, {
                "status": "ok", "message": "",
                "solution": {"url": url, "status": 200, "headers": {},
                             "response": BLOCK_NOTICE % {"kind": pre_kind, "reason": pre,
                                                         "final": url},
                             "cookies": [], "userAgent": UA,
                             "blocked": pre, "blockedKind": pre_kind, "solveTime": 0.0},
                "startTimestamp": int(start * 1000),
                "endTimestamp": int(time.time() * 1000),
                "version": VERSION})

        timeout_ms = int(payload.get("maxTimeout") or 60000)
        try:
            solution = do_request_get(url, timeout_ms)
            solution["solveTime"] = round(time.time() - start, 2)
            _STATS["oks"] += 1
            _STATS["failStreak"] = 0
            _STATS["lastOkAt"] = time.strftime("%Y-%m-%d %H:%M:%S")
            # 拦截分支返回的是"已跳过"提示而非页面正文，日志必须能一眼区分，
            # 否则会出现 "ok request.get -> login.taobao.com" 这种误导组合。
            # 拦截时刻意只打原始请求 URL：登录跳转 URL 常带上千字符的签名参数，
            # 灌进日志既无价值又掩盖真实信息。
            if solution.get("blocked"):
                log("ok(blocked) %s -> %s in %.2fs (落点 %s, kind=%s, 提示 %d chars, cookies=%d)"
                    % (cmd, url, solution["solveTime"], solution["blocked"],
                       solution.get("blockedKind"), len(solution["response"]),
                       _STATS["lastCookies"]))
            else:
                log("ok %s -> %s in %.2fs (%d bytes, cookies=%d)" % (
                    cmd, solution["url"], solution["solveTime"],
                    len(solution["response"]), _STATS["lastCookies"]))
            return self._send(200, {"status": "ok", "message": "", "solution": solution,
                                    "startTimestamp": int(start * 1000),
                                    "endTimestamp": int(time.time() * 1000),
                                    "version": VERSION})
        except Exception as e:
            _STATS["fails"] += 1
            _STATS["failStreak"] += 1
            _STATS["lastError"] = str(e)[:300]
            _STATS["lastErrorAt"] = time.strftime("%Y-%m-%d %H:%M:%S")
            log("fail %s %s: %s" % (cmd, url, e))
            traceback.print_exc()
            # 浏览器可能已崩：完整重建（含 playwright 实例），下次请求自动拉起
            _full_reset()
            return self._send(200, {"status": "error", "message": str(e), "solution": {},
                                    "startTimestamp": int(start * 1000),
                                    "endTimestamp": int(time.time() * 1000),
                                    "version": VERSION})

    def log_message(self, fmt, *args):  # 静默默认的每请求日志，只留自己的 log()
        return


def main() -> int:
    global HEADLESS, PROFILE_DIR, MIN_HOST_GAP, MIN_GLOBAL_GAP, JITTER
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8192)
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--headless", action="store_true", help="用无头浏览器（默认有头，反检测更好）")
    ap.add_argument("--warmup", action="store_true", help="启动时预热浏览器")
    ap.add_argument("--profile-dir", default=PROFILE_DIR, help="持久化 profile 目录")
    ap.add_argument("--min-host-gap", type=float, default=MIN_HOST_GAP,
                    help="同一 host 两次请求的最小间隔秒数（0=关闭）")
    ap.add_argument("--min-global-gap", type=float, default=MIN_GLOBAL_GAP,
                    help="任意两次请求的最小间隔秒数（0=关闭）")
    ap.add_argument("--jitter", type=float, default=JITTER,
                    help="在最小间隔之上叠加的随机抖动上限（秒）")
    a = ap.parse_args()
    HEADLESS = bool(a.headless)
    PROFILE_DIR = os.path.abspath(a.profile_dir)
    MIN_HOST_GAP = max(0.0, float(a.min_host_gap))
    MIN_GLOBAL_GAP = max(0.0, float(a.min_global_gap))
    JITTER = max(0.0, float(a.jitter))

    if a.warmup:
        log("warming up browser...")
        _ensure_context()

    srv = HTTPServer((a.host, a.port), Handler)
    log("listening on http://%s:%d  (headless=%s, version=%s, pid=%d, profile=%s, "
        "gap: host=%.2fs global=%.2fs jitter=%.2fs)"
        % (a.host, a.port, HEADLESS, VERSION, os.getpid(), PROFILE_DIR,
           MIN_HOST_GAP, MIN_GLOBAL_GAP, JITTER))

    def _beat() -> None:
        while True:
            time.sleep(300)
            log("heartbeat pid=%d" % os.getpid())

    threading.Thread(target=_beat, daemon=True).start()
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        log("bye")
    finally:
        _drop_context()
        try:
            if _browser:
                _browser.close()
            if _pw:
                _pw.stop()
        except Exception:
            pass
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except SystemExit:
        raise
    except BaseException:
        log("FATAL: %s" % traceback.format_exc())
        raise
