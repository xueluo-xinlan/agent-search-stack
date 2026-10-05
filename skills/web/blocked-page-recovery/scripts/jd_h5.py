#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""京东商品元数据抓取（走 H5 版站点，免登录、免浏览器）。

为什么走 item.m.jd.com 而不是 item.jd.com（2026-10 实测）：
  · item.jd.com       未登录流量得到通用壳 39KB（标题是"京东(JD.COM)-正品低价…"）；
                      真浏览器走该 URL 会被踢到 pc-frequent-pro.pf.jd.com（风控）
  · item.m.jd.com     直出完整商品页，机房 IP 与住宅 IP 结果逐字节一致

价格不在可得范围内：H5 页内嵌 "priceLoginText":"登录查看价格" 与
"urgeLogin":true，价格字段值是占位符。价格必须登录，本脚本不提供——
这是有意的诚实降级，不要当成脚本失败。

用法：
  python3 jd_h5.py 44807734636
  python3 jd_h5.py 44807734636 100012043978 --json
  python3 jd_h5.py https://item.jd.com/44807734636.html
  python3 jd_h5.py --file skus.txt --json --out result.json
"""
import argparse
import json
import re
import sys
import urllib.request

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0")

# 促销字段真名（2026-10 从 item.m.jd.com 页面里实际挖出，非猜测）
PROMO_KEYS = (
    "promoText", "promotionText", "couponDiscount", "couponFullReduction",
    "couponFullReturn", "couponGift", "discountText", "discountRate",
    "presaleCouponPriceText", "couponType",
)


def sku_of(text: str) -> str:
    """从 sku 数字或任意京东 URL 里取出 sku。

    优先认 URL 结构，避免把 URL 里其它数字误当 sku。
    """
    for pat in (r"/product/(\d{6,})", r"/(\d{6,})\.html", r"[?&]sku(?:Id)?=(\d{6,})"):
        m = re.search(pat, text)
        if m:
            return m.group(1)
    m = re.search(r"\b(\d{6,})\b", text)
    if not m:
        raise SystemExit("无法从输入里解析出 sku: %s" % text)
    return m.group(1)


def fetch(sku: str) -> str:
    url = "https://item.m.jd.com/product/%s.html" % sku
    req = urllib.request.Request(url, headers={
        "User-Agent": UA,
        "Accept-Language": "zh-CN,zh;q=0.9",
        "Referer": "https://item.jd.com/%s.html" % sku,
    })
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read().decode("utf-8", "replace")


def _first(pat, h, group=1):
    m = re.search(pat, h, re.S)
    return m.group(group).strip() if m else None


def _promos(h: str):
    out = []
    for k in PROMO_KEYS:
        for m in re.finditer(r'"%s"\s*:\s*"([^"]{1,120})"' % k, h):
            v = m.group(1).strip()
            if v and "%s=%s" % (k, v) not in out:
                out.append("%s=%s" % (k, v))
            if len(out) >= 10:
                return out
    return out


def parse(h: str) -> dict:
    t = _first(r"<title>(.*?)</title>", h)
    return {
        "pageTitle": t,
        "skuName": _first(r'"skuName":"(.*?)"', h) or t,
        "brand": _first(r'"brandName":"(.*?)"', h),
        "venderId": _first(r'"venderId":"?(\d+)"?', h),
        "shopName": _first(r'"shopName":"(.*?)"', h),
        "selfOperated": "自营" if "自营" in h else None,
        "inStock": "现货" if "现货" in h else None,
        "promo": _promos(h),
        "priceAccess": "登录查看价格" if "登录查看价格" in h else "未知",
        "chars": len(h),
        # 风控兜底自检：真商品页不会出现这些
        "looksBlocked": any(k in h for k in ("抱歉，页面不存在", "pc-frequent-pro", "risk_handler")),
    }


def run_one(target: str) -> dict:
    sku = sku_of(target)
    d = parse(fetch(sku))
    d["sku"] = sku
    d["source"] = "https://item.m.jd.com/product/%s.html" % sku
    return d


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("targets", nargs="*", help="sku 或任意京东商品 URL，可多个")
    ap.add_argument("--file", help="从文件读 sku 列表（每行一个）")
    ap.add_argument("--json", action="store_true", help="输出 JSON（单个对象或数组）")
    ap.add_argument("--out", help="把 JSON 结果写入文件")
    a = ap.parse_args()

    targets = list(a.targets)
    if a.file:
        with open(a.file, encoding="utf-8") as f:
            targets += [ln.strip() for ln in f if ln.strip()]
    if not targets:
        ap.error("至少给一个 sku/URL，或用 --file")

    results = []
    for t in targets:
        try:
            results.append(run_one(t))
        except Exception as e:
            results.append({"input": t, "error": str(e)[:200]})

    payload = results if len(results) > 1 else results[0]
    if a.out:
        with open(a.out, "w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False, indent=2)
        print("written: %s (%d item(s))" % (a.out, len(results)))

    if a.json:
        print(json.dumps(payload, ensure_ascii=False, indent=2))
        return 0

    for d in results:
        if "error" in d:
            print("[FAIL] %s -> %s" % (d["input"], d["error"]))
            continue
        print("sku       : %s" % d["sku"])
        print("标题      : %s" % d["skuName"])
        print("品牌      : %s" % d["brand"])
        print("店铺      : %s (id=%s)" % (d["shopName"], d["venderId"]))
        print("自营/现货 : %s / %s" % (d["selfOperated"], d["inStock"]))
        print("促销      : %s" % ("; ".join(d["promo"]) if d["promo"] else "(无)"))
        print("价格      : 不可得（%s）" % d["priceAccess"])
        if d["looksBlocked"]:
            print("!! 疑似风控/非商品页，请人工复核")
        print("-" * 40)
    return 0


if __name__ == "__main__":
    sys.exit(main())
