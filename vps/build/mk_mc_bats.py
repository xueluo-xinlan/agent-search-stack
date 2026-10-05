#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""生成 MediaCrawler 各平台一键扫码抓取脚本（GBK 编码，零交互）。

关键修正：uv 用绝对路径（用户双击时的 PATH 与 SSH 会话不同，
直接写 `uv run` 有概率报「uv 不是内部或外部命令」）。
"""
import pathlib

PLATS = [
    ("xhs",   "xhs",      "小红书",   "小红书App",  "run_xhs.bat"),
    ("bili",  "bilibili", "B站",      "哔哩哔哩App", "run_bili.bat"),
    ("tieba", "tieba",    "百度贴吧", "百度App",     "run_tieba.bat"),
    ("zhihu", "zhihu",    "知乎",     "知乎App",     "run_zhihu.bat"),
    ("wb",    "weibo",    "微博",     "微博App",     "run_weibo.bat"),
    ("dy",    "douyin",   "抖音",     "抖音App",     "run_douyin.bat"),
    ("ks",    "kuaishou", "快手",     "快手App",     "run_kuaishou.bat"),
]

TMPL = """@echo off
chcp 936 >nul
title MediaCrawler - {cn}搜索抓取
cd /d C:\\Users\\you\\Project_MediaCrawler

set "KW=%~1"
if "%KW%"=="" set "KW=手办柜"

set "UV=C:\\Users\\you\\AppData\\Local\\hermes\\bin\\uv.exe"
if not exist "%UV%" set "UV=uv"

echo ============================================================
echo    {cn} 搜索抓取   (MediaCrawler)
echo ============================================================
echo.
echo    关键词  : %KW%
echo    条数上限: 30  (改 config\\base_config.py 的 CRAWLER_MAX_NOTES_COUNT)
echo    数据落盘: data\\{d}\\  (json)
echo.
echo    [首次运行] 会自动打开一个独立浏览器窗口(不是你的日常 Edge),
echo               并在浏览器里显示登录二维码; 用手机 {app} 扫码即可.
echo               二维码也可能另弹一个图片窗口, 扫哪个都行.
echo               登录态会保存, 之后运行无需再扫.
echo.
echo    等待扫码的最长时间约 10 分钟, 请从容操作.
echo ============================================================
echo.

"%UV%" --version >nul 2>&1
if errorlevel 1 (
  echo    [错误] 找不到 uv 命令, 无法启动.
  echo           请确认存在: C:\\Users\\you\\AppData\\Local\\hermes\\bin\\uv.exe
  echo.
  pause
  exit /b 1
)

"%UV%" run main.py --platform {p} --lt qrcode --type search --keywords "%KW%" --save_data_option json

echo.
echo ============================================================
echo    抓取结束. 生成的数据文件:
echo ============================================================
if exist data\\{d}\\*.json dir /b data\\{d}\\*.json
echo.
pause
"""

outdir = pathlib.Path("~/build/mc_bats")
outdir.mkdir(parents=True, exist_ok=True)
for old in outdir.glob("*.bat"):
    old.unlink()

for p, d, cn, app, fn in PLATS:
    txt = TMPL.format(p=p, d=d, cn=cn, app=app)
    b = txt.replace("\n", "\r\n").encode("gbk")
    f = outdir / fn
    f.write_bytes(b)
    back = f.read_bytes().decode("gbk")
    assert cn in back and ("--platform " + p) in back and ("data\\" + d) in back and "uv.exe" in back
    print(f"OK {fn:18s} {len(b):5d} B  platform={p} datadir={d}")

print("\n共 %d 个脚本 -> %s" % (len(PLATS), outdir))
