"""本地正文提取 provider —— Trafilatura（+ 可选 curl_cffi TLS 指纹）。

设计要点
--------
1. 本模块注册一个名为 ``local_extract`` 的 web provider，使
   ``hermes config set web.extract_backend local_extract`` 可用（纯本地链路）。
2. 更常用的形态是**免密钥兜底**：``register()`` 会把本提取器追加进
   ``plugins.web.keyless_mcp._KEYLESS_RING`` 的**末位**，于是当
   ``extract_backend: exa``（默认）遇到 Exa 免密钥档限流、且 Parallel /
   Firecrawl / Keenable 也全部限流时，Hermes 的 ``extract_with_failover``
   会自动走到本地提取——零成本、无限流、查询不出网。
3. 抓取优先用 ``curl_cffi``（模拟 Chrome 的 TLS/JA3 指纹，绕过大量基于
   指纹的拦截）；未安装时退回 ``trafilatura.fetch_url``。
4. 本插件位于用户级 ``~/.hermes/plugins/``，不修改 Hermes 安装树，
   ``hermes update`` 不会覆盖。

环境依赖（装入 Hermes venv）::

    venv/bin/pip install trafilatura lxml_html_clean curl_cffi
"""

from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional

from plugins.web._common import BaseWebSearchProvider, document, page_error

logger = logging.getLogger(__name__)

NAME = "local_extract"
DISPLAY_NAME = "Local (Trafilatura)"

# 兜底抓取的默认超时（秒）
_FETCH_TIMEOUT = 25
# 单页正文上限，避免超长页面撑爆上下文
_MAX_CHARS = 60000

_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36"
)


def _trafilatura():
    """惰性导入 trafilatura；未安装返回 None。"""
    try:
        import trafilatura  # noqa: PLC0415 — 惰性导入，避免拖慢插件发现
        return trafilatura
    except Exception as exc:  # noqa: BLE001
        logger.debug("trafilatura 不可用: %s", exc)
        return None


def _curl_cffi():
    """惰性导入 curl_cffi.requests；未安装返回 None。"""
    try:
        from curl_cffi import requests as creq  # noqa: PLC0415
        return creq
    except Exception as exc:  # noqa: BLE001
        logger.debug("curl_cffi 不可用: %s", exc)
        return None


def fetch_html(url: str) -> Optional[str]:
    """抓取原始 HTML：curl_cffi（Chrome TLS 指纹）优先，退化到 trafilatura.fetch_url。"""
    creq = _curl_cffi()
    if creq is not None:
        for imp in ("chrome", "chrome136", "edge101"):
            try:
                resp = creq.get(url, impersonate=imp, timeout=_FETCH_TIMEOUT,
                                headers={"Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8"})
                if resp.status_code == 200 and (resp.text or "").strip():
                    return resp.text
                logger.debug("curl_cffi(%s) HTTP %s: %s", imp, resp.status_code, url)
            except Exception as exc:  # noqa: BLE001
                logger.debug("curl_cffi(%s) 失败 %s: %s", imp, url, exc)
    tra = _trafilatura()
    if tra is not None:
        try:
            return tra.fetch_url(url)
        except Exception as exc:  # noqa: BLE001
            logger.debug("trafilatura.fetch_url 失败 %s: %s", url, exc)
    return None


def extract_one(url: str) -> Dict[str, Any]:
    """抓取并提取单个 URL 的正文，返回 Hermes 文档结构（失败时带 error 字段）。"""
    tra = _trafilatura()
    if tra is None:
        return page_error(url, "本地提取不可用：trafilatura 未安装（venv/bin/pip install trafilatura lxml_html_clean）")
    html = fetch_html(url)
    if not html:
        return page_error(url, "本地抓取失败（curl_cffi 与 trafilatura 均未取到内容）")
    try:
        body = tra.extract(html, include_comments=False, include_tables=True,
                           favor_recall=True, url=url)
    except Exception as exc:  # noqa: BLE001
        return page_error(url, f"本地提取异常: {exc}")
    if not body or not body.strip():
        return page_error(url, "本地提取为空（疑似 JS 渲染页，需浏览器通道）")
    title = ""
    try:
        meta = tra.extract_metadata(html)
        title = getattr(meta, "title", "") or ""
    except Exception:  # noqa: BLE001 — 标题缺失不影响正文
        pass
    return document(url, title, body[:_MAX_CHARS])


def local_extract_batch(urls: List[str]) -> List[Dict[str, Any]]:
    """批量本地提取 —— 免密钥环调用签名 ``(urls) -> List[Dict]``。"""
    return [extract_one(u) for u in urls]


class LocalExtractProvider(BaseWebSearchProvider):
    """纯本地提取 provider（无搜索能力）。"""

    NAME = NAME
    DISPLAY_NAME = DISPLAY_NAME
    EXTRACT = True
    KEYLESS = True  # 无需任何 API key

    def is_available(self) -> bool:
        return _trafilatura() is not None

    def extract(self, urls: List[str], **kwargs: Any) -> List[Dict[str, Any]]:
        logger.info("本地提取 %d 个 URL（Trafilatura）", len(urls))
        return local_extract_batch(list(urls))

    def get_setup_schema(self) -> Dict[str, Any]:
        return {
            "name": NAME,
            "display_name": DISPLAY_NAME,
            "requires_key": False,
            "docs": "https://github.com/adbar/trafilatura",
            "description": (
                "本地正文提取，零成本无限流：Trafilatura 解析静态页正文，"
                "curl_cffi 提供 Chrome TLS 指纹。作为免密钥环末位兜底接入。"
            ),
        }
