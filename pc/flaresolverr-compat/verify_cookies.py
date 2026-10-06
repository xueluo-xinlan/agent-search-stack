#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""人工过验证 / 登录入口（配合 pc_flaresolverr_compat.py 的持久化 profile）。

为什么要它：一类墙只能靠"账号态"翻过去 —— 百度的人机验证（滑动拼图）、
淘宝的登录墙、京东的价格登录墙（实测四种 UA 全无效，见 blocked-page-recovery
技能「账号态的墙」一节）。过一次之后 cookie 写进同一个 profile 目录，常驻
兼容层下次请求直接复用。

默认一次把 京东 + 淘宝 + 拼多多 + 闲鱼 都打开（四个标签），你分别登录完再关
窗口即可，不必跑几趟。不需要的标签页直接关掉，不影响脚本。

用法（由 verify_cookies.bat 调用，不建议单独跑）：
    python verify_cookies.py                       # 默认 jd taobao pdd goofish
    python verify_cookies.py --sites jd            # 只弄京东
    python verify_cookies.py --sites jd taobao tieba

流程：有头打开浏览器 -> 用户手动过验证/登录 -> 用户关闭窗口 -> 本脚本退出，
bat 随即恢复常驻兼容层并自动验证登录态是否生效。
"""
import argparse
import os
import sys
import time

try:
    # 不要强制 gbk：Windows Terminal / 代码页 65001 下会把中文显示成乱码
    # （实测现场）。只加 errors 兜底，编码交给 Python 自己选——控制台走
    # WriteConsoleW，被重定向时用 locale 编码，两种情况都不会崩。
    sys.stdout.reconfigure(errors="replace")
    sys.stderr.reconfigure(errors="replace")
except Exception:
    pass

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
PROFILE_DIR = os.path.join(BASE_DIR, "browser_profile")

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0")
ARGS = [
    "--disable-blink-features=AutomationControlled",
    "--no-first-run",
    "--no-default-browser-check",
    # bat 第 1 步是 Stop-Process -Force 强杀上一个实例，Edge 会把它记成"意外关闭"，
    # 下次启动弹出"还原页面"气泡并挡在主窗口前面。实测现场：用户只看到控制台
    # 窗口，以为浏览器根本没起来，实际是主窗口被这个气泡压在后面。
    "--disable-session-crashed-bubble",
    "--hide-crash-restore-bubble",
    "--disable-features=InfiniteSessionRestore",
    # Edge/Chrome 默认"关闭窗口后继续在后台运行"，会让关窗后进程残留在后台
    # （实测现场：9 个 msedge 进程仍占着 profile，本脚本的等待循环永远等不到
    # "窗口已关闭"）。禁掉这个后台模式，关窗即退出。
    "--disable-background-mode",
]

SITES = {
    # 京东：PC 首页 www.jd.com 在本环境必被风控（日志一贯落
    # pc-frequent-pro.pf.jd.com，连登录入口都进不去），改走移动扫码登录页。
    # 登录后 cookie 用于抓 item.m.jd.com 移动商品页（实测可出 44 万字节正文）。
    "jd":      "https://plogin.m.jd.com/login/login?appid=2193",
    "taobao":  "https://www.taobao.com/",
    "tieba":   "https://tieba.baidu.com/",
    "suning":  "https://www.suning.com/",
    # 拼多多 H5（游客态实测 200 / 42KB）；登录后 cookie 覆盖 mobile.yangkeduo.com
    "pdd":     "https://mobile.yangkeduo.com/",
    # 闲鱼 PC 网页版（2.taobao.com 301 到它）；与淘宝同属阿里账号体系
    "goofish": "https://www.goofish.com/",
}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--sites", nargs="+",
                    default=["jd", "taobao", "pdd", "goofish"],
                    choices=sorted(SITES),
                    help="要登录的站点，可多个（默认 jd taobao）")
    ap.add_argument("--profile-dir", default=PROFILE_DIR)
    a = ap.parse_args()

    os.makedirs(a.profile_dir, exist_ok=True)

    from playwright.sync_api import sync_playwright

    print("=" * 62)
    print("  人工验证窗口（cookie 将写入持久化 profile）")
    print("=" * 62)
    print("  将打开 %d 个标签页：" % len(a.sites))
    for s in a.sites:
        print("    · %-8s %s" % (s, SITES[s]))
    print("  请在每个标签页里完成：")
    print("    · 出现拼图/滑块验证 -> 手动拖过")
    print("    · 需要登录的站点   -> 扫码或账号登录")
    print("  全部完成后【关闭那个浏览器窗口】，本程序会自动退出。")
    print("-" * 62)

    with sync_playwright() as pw:
        kwargs = dict(
            user_data_dir=a.profile_dir,
            headless=False,
            args=ARGS,
            user_agent=UA,
            locale="zh-CN",
            viewport={"width": 1366, "height": 900},
            ignore_https_errors=True,
        )
        try:
            ctx = pw.chromium.launch_persistent_context(channel="msedge", **kwargs)
        except Exception as e:
            print("  msedge 启动失败(%s)，改用内置 chromium" % str(e)[:80])
            ctx = pw.chromium.launch_persistent_context(**kwargs)

        ctx.add_init_script(
            "Object.defineProperty(navigator,'webdriver',{get:()=>undefined});"
        )

        opened = []
        for i, name in enumerate(a.sites):
            if i == 0 and ctx.pages:
                page = ctx.pages[0]
            else:
                page = ctx.new_page()
            try:
                page.goto(SITES[name], wait_until="domcontentloaded", timeout=45000)
            except Exception as e:
                print("  [%s] 首次导航提示（可忽略，手动在地址栏输入即可）：%s"
                      % (name, str(e)[:80]))
            opened.append((name, SITES[name]))

        print("  浏览器已打开，等待你操作……")
        print("  完成后请【关闭整个浏览器窗口】（只关标签页不会结束本程序）")
        # 判据用"浏览器连接是否还在"，不用"标签页是否为空"：
        # 实测 Edge 关掉窗口后进程会残留在后台，此时 ctx.pages 仍非空，
        # 用 pages 判空会让脚本永远等下去。再加一条"连续 15 秒无任何标签页"
        # 的兜底，覆盖用户只关标签、不关窗口的情况。
        empty_since = None
        while True:
            time.sleep(1)
            try:
                connected = ctx.browser is not None and ctx.browser.is_connected()
                pages = ctx.pages
            except Exception:
                break                      # 浏览器整体已关闭
            if not connected:
                break                      # 浏览器进程退出（正常路径）
            if pages:
                empty_since = None
            else:
                if empty_since is None:
                    empty_since = time.time()
                elif time.time() - empty_since >= 15:
                    print("  所有标签页已关闭 15 秒，视为完成。")
                    break

        print("-" * 62)
        print("  浏览器已关闭。本次各站 cookie：")
        total = 0
        for name, url in opened:
            try:
                cks = ctx.cookies(url)
                n = len(cks)
                names = sorted({c.get("name", "") for c in cks})
            except Exception:
                n, names = -1, []
            total += max(n, 0)
            print("    %-8s %d 条" % (name, n))
            if names:
                shown = ", ".join(names[:25]) + (" …" if len(names) > 25 else "")
                print("             %s" % shown)
        try:
            allc = len(ctx.cookies())
        except Exception:
            allc = -1
        print("  profile 内 cookie 总计：%d（本次各站合计 %d）" % (allc, total))

    print("  完成。常驻兼容层将由 bat 重新拉起，并自动验证登录态。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
