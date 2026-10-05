#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Probe a batch of URLs: is what came back CONTENT, or a risk-control /
login interstitial?

Prints only status / size / title / keyword hits -- NEVER the body. That
keeps the context small and stops pollution strings (adult-site domains and
the like) from being echoed into the conversation, where they would be
replayed to the upstream on every later turn.

Usage:
    python3 probe_pages.py https://item.jd.com/44807734636.html https://tieba.baidu.com/p/10701873689
    python3 probe_pages.py --file urls.txt
    python3 probe_pages.py --ua curl <url>...      # contrast browser UA vs bare curl

Reading the output:
  several different IDs -> same title + near-identical size  => degraded shell page, not content
  LOGINWALL or RISK group hits                               => login wall / risk-control page
  GOODS group hits and a sane size                           => probably real content
"""
import argparse
import html
import re
import subprocess

UA_CHROME = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
             "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36")

KW = {
    "LOGINWALL": ["login.taobao.com", "passport.jd.com", "plogin", "login.html",
                  "/login", "havana", "fm-login", "unb=", "_nk_=",
                  "\u4eb2\uff0c\u8bf7\u767b\u5f55"],
    "RISK":      ["risk_handler", "captcha", "verify", "security",
                  "\u5b89\u5168\u9a8c\u8bc1", "frequent-pro", "\u9891\u63a7"],
    "GOODS":     ["skuid", "itemid", "price", "td-price", "j_price",
                  "\u4fc3\u9500\u4ef7"],
}


def fetch(url, ua, timeout):
    """Return (meta line, raw body). -w metadata is delimited by a sentinel
    because the body itself can contain arbitrary bytes."""
    p = subprocess.run(
        ["curl", "-s", "--compressed", "-m", str(timeout), "-A", ua,
         "-w", "\n__META__%{http_code} %{size_download} %{redirect_url}", url],
        capture_output=True)
    raw, meta = p.stdout, ""
    i = raw.rfind(b"__META__")
    if i >= 0:
        meta = raw[i + 8:].decode("utf-8", "replace").strip()
        raw = raw[:i]
    return meta, raw


def decode(body):
    for enc in ("utf-8", "gbk", "latin-1"):
        try:
            return body.decode(enc)
        except UnicodeDecodeError:
            continue
    return ""


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("urls", nargs="*")
    ap.add_argument("--file", help="text file with one URL per line")
    ap.add_argument("--ua", default="chrome", choices=["chrome", "curl"])
    ap.add_argument("--timeout", type=int, default=25)
    a = ap.parse_args()

    urls = list(a.urls)
    if a.file:
        with open(a.file, encoding="utf-8") as fh:
            urls += [ln.strip() for ln in fh if ln.strip()]
    if not urls:
        ap.error("give at least one URL (or --file)")

    ua = UA_CHROME if a.ua == "chrome" else "curl/8.4.0"
    for u in urls:
        meta, body = fetch(u, ua, a.timeout)
        txt = decode(body)
        low = txt.lower()
        m = re.search(r"<title[^>]*>(.*?)</title>", txt, re.S | re.I)
        title = re.sub(r"\s+", " ", html.unescape(m.group(1))).strip()[:90] if m else ""
        hits = ["%s=%s" % (g, ",".join(w for w in ws if w in low))
                for g, ws in KW.items() if any(w in low for w in ws)]
        print("%s\n    url=%s\n    title=%r\n    %s"
              % (meta, u, title, " | ".join(hits) if hits else "keywords=none"))


if __name__ == "__main__":
    main()
