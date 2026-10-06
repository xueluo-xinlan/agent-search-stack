# -*- coding: utf-8 -*-
# 引导登录：打开淘宝 / 京东首页，由人工完成登录，cookie 落到本机 Edge 持久化 profile。
# 与 verify_cookies.py 配套——先跑本脚本刷登录态，再用 verify_cookies.py 验证 cookie 是否可用。
# 依赖：playwright（`pip install playwright && playwright install msedge`）；需本机装有 Edge。
# 说明：窗口会保持约 25 分钟后自动关闭；期间请手动登录并勾选「记住登录状态」。
import time, traceback
from playwright.sync_api import sync_playwright

UD = r"C:\Users\you\edge_profile"  # ← 改成你自己的路径（此目录会保存登录 cookie）
LOG = r"C:\Users\you\guided_login_log.txt"

def log(m):
    with open(LOG, "a", encoding="utf-8") as f:
        f.write(m + "\n")

log("=== start ===")
try:
    with sync_playwright() as p:
        ctx = p.chromium.launch_persistent_context(
            UD, channel="msedge", headless=False, locale="zh-CN",
            args=["--disable-blink-features=AutomationControlled", "--start-maximized"],
            no_viewport=True,
        )
        pg = ctx.pages[0] if ctx.pages else ctx.new_page()
        for url in ["https://www.taobao.com/", "https://www.jd.com/"]:
            for attempt in range(3):
                try:
                    pg.goto(url, wait_until="domcontentloaded", timeout=45000)
                    log("OK " + url)
                    break
                except Exception as e:
                    log("retry%d %s %s" % (attempt, url, str(e)[:90]))
                    time.sleep(3)
            time.sleep(2)
        for _ in range(1500):
            time.sleep(1)
        ctx.close()
except Exception:
    log(traceback.format_exc()[:800])
