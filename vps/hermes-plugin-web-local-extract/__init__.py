"""本地正文提取插件（单文件）—— Trafilatura + curl_cffi TLS 指纹。

作用
----
1. 注册一个名为 ``local_extract`` 的 web provider，可作为 ``web.extract_backend`` 的取值（纯本地链路）。
2. **免密钥环兜底**：把本地提取器追加到 ``plugins.web.keyless_mcp._KEYLESS_RING`` 末位。
   Hermes 的 ``extract_with_failover`` 在 Exa / Parallel / Firecrawl / Keenable
   四个远程免密钥档**全部限流**时，会自动走到本地提取——零成本、无限流、查询不出网。
   （触发条件：整批 URL 都返回"限流型"错误；单个页面的 403/404 属页面问题，不触发切换，
     这是 Hermes 原有语义，本插件不改动它。）
3. 抓取优先 curl_cffi（模拟 Chrome TLS/JA3 指纹），未装则退化到 trafilatura.fetch_url。

位置与升级安全
--------------
本插件位于用户级 ``~/.hermes/plugins/web-local-extract/``，不修改 Hermes 安装树，
``hermes update`` 不会覆盖。若升级重建了 venv，需重装依赖：
``venv/bin/pip install trafilatura lxml_html_clean curl_cffi``

配置
----
- 免密钥兜底：无需任何配置，装上并启用即生效（``web.keyless_fallback`` 默认为 true）。
- 强制纯本地：``hermes config set web.extract_backend local_extract``
"""

from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

NAME = "local_extract"
DISPLAY_NAME = "Local (Trafilatura)"

_FETCH_TIMEOUT = 25
_MAX_CHARS = 60000


def _trafilatura():
    """惰性导入 trafilatura；未安装返回 None。"""
    try:
        import trafilatura  # noqa: PLC0415
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
    """抓原始 HTML：curl_cffi（Chrome TLS 指纹）优先，退化到 trafilatura.fetch_url。"""
    creq = _curl_cffi()
    if creq is not None:
        for imp in ("chrome", "chrome136", "edge101"):
            try:
                resp = creq.get(
                    url, impersonate=imp, timeout=_FETCH_TIMEOUT,
                    headers={"Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8"},
                )
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


def _page_error(url: str, error: str) -> Dict[str, Any]:
    """与 Hermes ``plugins.web._common.page_error`` 同构（此处内联，避免包名导入依赖）。"""
    return {"url": url, "title": "", "content": "", "error": error}


def _document(url: str, title: str, content: str) -> Dict[str, Any]:
    """与 Hermes ``plugins.web._common.document`` 同构。"""
    return {
        "url": url, "title": title, "content": content, "raw_content": content,
        "metadata": {"sourceURL": url, "title": title},
    }


def extract_one(url: str) -> Dict[str, Any]:
    """抓取并提取单个 URL 正文；失败返回带 error 的结构（Hermes 契约：不抛异常）。"""
    tra = _trafilatura()
    if tra is None:
        return _page_error(url, "本地提取不可用：trafilatura 未安装（venv/bin/pip install trafilatura lxml_html_clean）")
    html = fetch_html(url)
    if not html:
        return _page_error(url, "本地抓取失败（curl_cffi 与 trafilatura 均未取到内容）")
    try:
        body = tra.extract(html, include_comments=False, include_tables=True,
                           favor_recall=True, url=url)
    except Exception as exc:  # noqa: BLE001
        return _page_error(url, f"本地提取异常: {exc}")
    if not body or not body.strip():
        return _page_error(url, "本地提取为空（疑似 JS 渲染页，需浏览器通道）")
    title = ""
    try:
        meta = tra.extract_metadata(html)
        title = getattr(meta, "title", "") or ""
    except Exception:  # noqa: BLE001 — 标题缺失不影响正文
        pass
    return _document(url, title, body[:_MAX_CHARS])


def local_extract_batch(urls: List[str]) -> List[Dict[str, Any]]:
    """批量本地提取 —— 免密钥环调用签名 ``(urls) -> List[Dict]``。"""
    return [extract_one(u) for u in urls]


def _provider_class():
    """构建 provider 类（继承关系需要 Hermes 内部模块，故惰性构造）。"""
    from plugins.web._common import BaseWebSearchProvider

    class LocalExtractProvider(BaseWebSearchProvider):
        """纯本地提取 provider（无搜索能力，无需任何 key）。"""

        NAME = NAME
        DISPLAY_NAME = DISPLAY_NAME
        EXTRACT = True
        KEYLESS = True

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

    return LocalExtractProvider


def _install_keyless_ring_hook() -> bool:
    """把本地提取器接到免密钥环末位。幂等；失败只告警不致命。"""
    try:
        import plugins.web.keyless_mcp as km

        ring = tuple(km._KEYLESS_RING)
        if "local" not in ring:
            km._KEYLESS_RING = ring + ("local",)
            logger.info("免密钥提取环已扩展: %s", km._KEYLESS_RING)
        km._KEYLESS_EXTRACTORS["local"] = local_extract_batch
        return True
    except Exception as exc:  # noqa: BLE001
        logger.warning("免密钥环注入失败（本地提取将只能显式指定 backend 使用）: %s", exc)
        return False


def register(ctx) -> None:
    """Hermes 插件入口：注册 provider + 注入免密钥环兜底。"""
    cls = _provider_class()
    ctx.register_web_search_provider(cls())
    _install_keyless_ring_hook()
