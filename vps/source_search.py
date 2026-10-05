#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""多源直连检索器 —— 绕过 SearXNG 引擎适配器，直连各站官方 API。

为什么需要它
------------
A-lite SearXNG（127.0.0.1:8890）在机房 IP 下的引擎适配器多数已失效：
  · 零产出且无异常：wikipedia / wikidata / mojeek / 360search
  · CAPTCHA 拦截：duckduckgo / qwant / baidu
  · 403 / 429：google / brave
实测稳定可用的只有 bing（中文查询存在随机零产出）与 yandex。
但上述站点的**官方 API 直连全部 200 且 0.3–0.7s**（2026-10-04 实测），
因此按「站点定位」直连 API 比走元搜索更快、更准、更稳。

用法
----
  python3 ~/source_search.py "查询词" [--sources wikipedia,hn,arxiv,so,github,crossref,ddg]
                                       [--lang zh|en] [--limit 5] [--json]
                                       [--save PATH] [--no-dedupe]

`--save PATH` 把结果追加进 JSONL 归档（每行含 ts/query/lang/source/url/title/snippet）；
默认按 url 与已有归档去重，`--no-dedupe` 关闭。多轮查同一题目时用它攒结果。

默认 sources = wikipedia,hn,arxiv,so,github,crossref（越靠前的越权威/越相关）。
"""
from __future__ import annotations

import argparse
import concurrent.futures as cf
import gzip
import html
import io
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET

UA = "hermes-agent-source-search/1.0 (+https://hermes-agent.nousresearch.com)"
TIMEOUT = 14
ATOM = "{http://www.w3.org/2005/Atom}"


def _get(url: str, timeout: int = TIMEOUT) -> bytes:
    req = urllib.request.Request(url, headers={
        "User-Agent": UA,
        "Accept": "application/json, application/atom+xml, text/xml, */*",
        "Accept-Encoding": "gzip",
    })
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        raw = resp.read()
        if resp.headers.get("Content-Encoding", "").lower() == "gzip":
            raw = gzip.GzipFile(fileobj=io.BytesIO(raw)).read()
        return raw


def _qs(params: dict) -> str:
    return urllib.parse.urlencode(params)


def _clean(s: str, n: int = 220) -> str:
    s = html.unescape(s or "")
    s = re.sub(r"<[^>]+>", "", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s[:n]


# ─────────────────────── 各源实现：返回 [{"title","url","snippet","meta"}] ───────────────────────

_CJK_RE = re.compile(r"[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\u3040-\u30ff\uac00-\ud7af]")


def _wiki_search(base: str, srsearch: str, limit: int) -> list:
    api = base + _qs({"action": "query", "list": "search", "srsearch": srsearch,
                      "format": "json", "srlimit": limit, "utf8": 1})
    return json.loads(_get(api)).get("query", {}).get("search", []) or []


def _wiki_phrase(s: str) -> str:
    """剥离会破坏 MediaWiki 查询语法的字符（引号 / 反斜杠）。"""
    return re.sub(r'[\\"]', " ", s).strip()


def src_wikipedia(q: str, lang: str, limit: int):
    """Wikipedia 搜索，**标题命中优先**。

    中文维基走 CirrusSearch 分词：多词查询 "A B" 会被拆成独立词项匹配，于是
    "零知识证明 基本原理" 返回的是《纯粹理性批判》这类只命中"基本原理"的条目，
    真正相关的词条被挤出榜单（2026-10-04 实测）。

    对策：先用 `intitle:"…"` 精确标题查询让命中排前（中文按空格分段并发查），
    再用原样全文查询补齐到 limit；英文整串 intitle 同样有效且与相关度排序兼容。
    """
    base = f"https://{lang}.wikipedia.org/w/api.php?"
    seen, out = set(), []

    def add(hits, tag: str) -> None:
        for it in hits:
            title = it.get("title", "")
            if not title or title in seen:
                continue
            seen.add(title)
            out.append({
                "title": title,
                "url": f"https://{lang}.wikipedia.org/wiki/{urllib.parse.quote(title)}",
                "snippet": _clean(it.get("snippet", "")),
                "meta": f"{tag}{it.get('wordcount', '?')}词 / {it.get('timestamp', '')[:10]}",
            })

    def _title_q(seg: str) -> str:
        """构造 intitle 查询。CJK / 含空格 / 含 `-` 的段必须加引号：不加会被分词或
        被解析成否定（`-tuning`）；而**单个拉丁词必须裸写**——加引号变成精确匹配，
        反而把 `LoRA (machine learning)` 这类词条挤出榜单（2026-10-04 实测）。"""
        if _CJK_RE.search(seg) or " " in seg or "-" in seg:
            return f'intitle:"{seg}"'
        return f"intitle:{seg}"

    # ① 标题精确命中：中文多词只取最长的中文段（整串短语零命中；弱限定段如
    #    "基本原理"会引入"世界語基礎"噪声，故不逐段并发，2026-10-04 实测）。
    if _CJK_RE.search(q) and " " in q.strip():
        parts = q.split()
        cjk_parts = [s for s in parts if _CJK_RE.search(s)]
        segs = [max(cjk_parts or parts, key=len)]
    else:
        segs = [q]
    for seg in [s for s in dict.fromkeys(_wiki_phrase(s) for s in segs) if s]:
        if len(out) >= limit:
            break
        try:
            add(_wiki_search(base, _title_q(seg), limit), "标题命中 · ")
        except Exception:  # 单段失败不拖累其余
            continue

    # ② 原样全文查询补齐
    if len(out) < limit:
        try:
            add(_wiki_search(base, q, limit), "")
        except Exception:
            if not out:
                raise
    # ③ 仍为空 → 逐段标题兜底。英文长技术串在 en 维基常整串零命中
    #    （"lora fine-tuning vram" → 0 条），但 intitle:"lora" 能给出
    #    "LoRA (machine learning)"（2026-10-04 实测）；仅在零命中时启用，避免噪声。
    if not out:
        for seg in [s for s in (_wiki_phrase(p) for p in q.split()) if s][:3]:
            if len(out) >= limit:
                break
            try:
                add(_wiki_search(base, _title_q(seg), limit), "标题命中 · ")
            except Exception:
                continue
    return out[:limit]


def src_hn(q: str, lang: str, limit: int):
    api = "https://hn.algolia.com/api/v1/search?" + _qs({"query": q, "hitsPerPage": limit})
    d = json.loads(_get(api))
    out = []
    for h in d.get("hits", []):
        title = _clean(h.get("title") or h.get("story_title") or "(HN 讨论)", 200)
        url = h.get("url") or f"https://news.ycombinator.com/item?id={h.get('objectID')}"
        out.append({
            "title": title, "url": url,
            "snippet": _clean(h.get("story_text") or h.get("comment_text") or "", 160),
            "meta": f"{h.get('points', 0)}分 / {h.get('num_comments', 0)}评",
        })
    return out


def src_arxiv(q: str, lang: str, limit: int):
    """arXiv 检索：多词查询必须加引号，否则空格被当作独立词项，返回大量无关条目
    （"zero knowledge proof" 会命中 LLM/知识图谱论文，2026-10-04 实测）；
    短语查询零命中时回退原样写法。"""
    phrase = re.sub(r'[\\"]', " ", q).strip()

    def _fetch(search_query: str):
        api = "https://export.arxiv.org/api/query?" + _qs({
            "search_query": search_query, "max_results": limit, "sortBy": "relevance"})
        return ET.fromstring(_get(api))

    root = _fetch(f'all:"{phrase}"') if phrase else None
    if root is None or not root.findall(f"{ATOM}entry"):
        root = _fetch(f"all:{q}")
    out = []
    for e in root.findall(f"{ATOM}entry"):
        title = _clean(e.findtext(f"{ATOM}title") or "", 200)
        link = e.findtext(f"{ATOM}id") or ""
        published = (e.findtext(f"{ATOM}published") or "")[:10]
        authors = [a.findtext(f"{ATOM}name") for a in e.findall(f"{ATOM}author")][:3]
        out.append({
            "title": title, "url": link,
            "snippet": _clean(e.findtext(f"{ATOM}summary") or "", 220),
            "meta": f"{published} / {', '.join(a for a in authors if a)}",
        })
    return out


def src_so(q: str, lang: str, limit: int):
    api = "https://api.stackexchange.com/2.3/search/advanced?" + _qs({
        "order": "desc", "sort": "relevance", "q": q,
        "site": "stackoverflow", "pagesize": limit})
    d = json.loads(_get(api))
    out = []
    for it in d.get("items", []):
        out.append({
            "title": _clean(it.get("title", ""), 200),
            "url": it.get("link", ""),
            "snippet": " / ".join(t for t in it.get("tags", [])[:5]),
            "meta": f"分{it.get('score', 0)} / 答{it.get('answer_count', 0)} / 阅{it.get('view_count', 0)}",
        })
    return out


def src_github(q: str, lang: str, limit: int):
    api = "https://api.github.com/search/repositories?" + _qs({"q": q, "per_page": limit})
    d = json.loads(_get(api))
    out = []
    for it in d.get("items", []):
        out.append({
            "title": it.get("full_name", ""),
            "url": it.get("html_url", ""),
            "snippet": _clean(it.get("description") or "", 200),
            "meta": f"★{it.get('stargazers_count', 0)} / {it.get('language') or '-'} / 更新{(it.get('updated_at') or '')[:10]}",
        })
    return out


def src_crossref(q: str, lang: str, limit: int):
    api = "https://api.crossref.org/works?" + _qs({
        "query": q, "rows": limit,
        "select": "title,URL,DOI,issued,container-title,author"})
    d = json.loads(_get(api))
    out = []
    for it in d.get("message", {}).get("items", []):
        t = (it.get("title") or ["(无标题)"])[0]
        year = ""
        parts = (it.get("issued") or {}).get("date-parts") or [[]]
        if parts and parts[0]:
            year = str(parts[0][0])
        journal = (it.get("container-title") or [""])[0]
        out.append({
            "title": _clean(t, 200),
            "url": it.get("URL") or (f"https://doi.org/{it.get('DOI')}" if it.get("DOI") else ""),
            "snippet": journal, "meta": f"{year} / DOI:{it.get('DOI', '-')}",
        })
    return out


def src_ddg(q: str, lang: str, limit: int):
    api = "https://api.duckduckgo.com/?" + _qs({
        "q": q, "format": "json", "no_html": 1, "no_redirect": 1})
    d = json.loads(_get(api))
    out = []
    if d.get("AbstractText"):
        out.append({"title": d.get("Heading") or q,
                    "url": d.get("AbstractURL") or "", "snippet": _clean(d["AbstractText"]),
                    "meta": d.get("AbstractSource", "")})
    for t in (d.get("RelatedTopics") or []):
        if len(out) >= limit:
            break
        if "Topics" in t:
            for s in t["Topics"]:
                if len(out) >= limit:
                    break
                if s.get("Text"):
                    out.append({"title": s["Text"][:80], "url": s.get("FirstURL", ""),
                                "snippet": _clean(s["Text"]), "meta": "DDG 相关"})
        elif t.get("Text"):
            out.append({"title": t["Text"][:80], "url": t.get("FirstURL", ""),
                        "snippet": _clean(t["Text"]), "meta": "DDG 相关"})
    return out


SOURCES = {
    "wikipedia": src_wikipedia,
    "hn": src_hn,
    "arxiv": src_arxiv,
    "so": src_so,
    "github": src_github,
    "crossref": src_crossref,
    "ddg": src_ddg,
}
DEFAULT_SOURCES = ["wikipedia", "hn", "arxiv", "so", "github", "crossref"]


def run(q: str, lang: str, limit: int, names: list[str]):
    result = {}
    with cf.ThreadPoolExecutor(max_workers=min(8, len(names))) as ex:
        futs = {ex.submit(SOURCES[n], q, lang, limit): n for n in names}
        for fut in cf.as_completed(futs):
            n = futs[fut]
            t0 = time.time()
            try:
                result[n] = {"ok": True, "items": fut.result(), "sec": round(time.time() - t0, 2)}
            except Exception as e:  # 单源失败不拖累整体
                result[n] = {"ok": False, "error": f"{type(e).__name__}: {e}", "items": []}
    return result


DEFAULT_SAVE = os.path.expanduser("~/.cache/source-search/archive.jsonl")


def save_results(path: str, q: str, lang: str, res: dict, dedupe: bool = True):
    """把结果追加到 JSONL 归档；按 url 去重。返回 (新增条数, 跳过条数)。"""
    seen = set()
    if dedupe and os.path.exists(path):
        try:
            with open(path, encoding="utf-8") as fh:
                for line in fh:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        seen.add(json.loads(line).get("url"))
                    except Exception:
                        continue
        except OSError:
            pass
    added = skipped = 0
    os.makedirs(os.path.dirname(os.path.abspath(path)), exist_ok=True)
    with open(path, "a", encoding="utf-8") as fh:
        for src, v in res.items():
            for it in v.get("items", []):
                u = it.get("url")
                if dedupe and u and u in seen:
                    skipped += 1
                    continue
                if u:
                    seen.add(u)
                fh.write(json.dumps({"ts": time.time(), "query": q, "lang": lang,
                                     "source": src, **it}, ensure_ascii=False) + "\n")
                added += 1
    return added, skipped


def main():
    ap = argparse.ArgumentParser(description="多源直连检索器")
    ap.add_argument("query")
    ap.add_argument("--sources", default=",".join(DEFAULT_SOURCES))
    ap.add_argument("--lang", default="zh")
    ap.add_argument("--limit", type=int, default=5)
    ap.add_argument("--json", action="store_true")
    ap.add_argument("--save", nargs="?", const=DEFAULT_SAVE, default=None,
                    help=f"把结果追加到 JSONL 归档（默认 {DEFAULT_SAVE}）")
    ap.add_argument("--no-dedupe", action="store_true", help="归档时不做 url 去重")
    a = ap.parse_args()

    names = [n.strip() for n in a.sources.split(",") if n.strip() in SOURCES]
    if not names:
        print("无有效源；可选：" + ", ".join(SOURCES), file=sys.stderr)
        sys.exit(2)

    t0 = time.time()
    res = run(a.query, a.lang, a.limit, names)
    total = sum(len(v["items"]) for v in res.values())
    save_note = ""
    if a.save:
        added, skipped = save_results(a.save, a.query, a.lang, res, dedupe=not a.no_dedupe)
        save_note = f"   存档: +{added} 条，去重跳过 {skipped} 条 → {a.save}"
    if a.json:
        print(json.dumps({"query": a.query, "elapsed": round(time.time() - t0, 2),
                          "sources": res}, ensure_ascii=False, indent=2))
        return

    print(f"查询: {a.query}   源数={len(names)}   条目={total}   总耗时={time.time()-t0:.2f}s{save_note}")
    for n in names:
        v = res.get(n, {})
        if not v.get("ok"):
            print(f"\n── {n} ✗ {v.get('error')}")
            continue
        print(f"\n── {n}（{len(v['items'])} 条，{v['sec']}s）")
        for it in v["items"]:
            print(f"   • {it['title']}")
            if it.get("snippet"):
                print(f"     {it['snippet'][:160]}")
            if it.get("url"):
                print(f"     {it['url']}")
            if it.get("meta"):
                print(f"     [{it['meta']}]")


if __name__ == "__main__":
    main()
