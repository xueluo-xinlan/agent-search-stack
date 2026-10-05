---
name: hermes-web-provider-plugin
version: 1.0.1
description: "Use when extending Hermes web providers or keyless ring."
author: hermes-agent
license: MIT
metadata:
  hermes:
    tags: [hermes, web-backend, plugin, extraction, keyless-ring]
    related_skills: [web-research-playbook, hermes-agent, blocked-page-recovery]
---

# Hermes Web Provider 插件开发

给 Hermes 增加/替换 web_search、web_extract 后端，或让 `web_extract` 在远程免密钥档限流时自动落到本地提取。

## When to Use（何时用）

- 要新增一个搜索/提取后端（自有 API、本地库、特殊反爬通道）
- 要让 `web_extract` 有**本地兜底**（Exa 等免费档限流时不停摆）
- 遇到 `no registered web extract provider has that name` 报错
- 判断某能力该走插件还是改核心

## 架构事实（源码级）

| 项 | 位置 |
|---|---|
| 用户级插件 | `<HERMES_HOME>/plugins/<name>/`（如 `~/.hermes/plugins/`），**升级不覆盖** |
| 内置插件 | 安装树 `plugins/web/<vendor>/`（exa/searxng/tavily/firecrawl/parallel/keenable/ddgs/openai_native） |
| 必需文件 | `plugin.yaml` + `__init__.py`（注册逻辑全可放这一个文件） |
| 发现入口 | `tools/web_tools._ensure_web_plugins_loaded()` → `hermes_cli.plugins._ensure_plugins_discovered()` |
| 注册 API | `ctx.register_web_search_provider(provider_instance)` |
| Provider 基类 | `plugins.web._common.BaseWebSearchProvider`（`agent.web_search_provider.WebSearchProvider`） |
| 分流函数 | `tools/web_tools._get_extract_backend()` = `web.extract_backend`（**严格，不探测**）> `web.backend` > autodetect |

`plugin.yaml` 最小形态：

```yaml
name: web-<vendor>
version: 1.0.0
description: "..."
kind: backend
provides_web_providers:
  - <provider_name>
```

Provider 契约：类属性 `NAME` / `DISPLAY_NAME` / `EXTRACT` / `KEYLESS`；方法 `search()` / `extract(urls, **kw)` / `is_available()` / `get_setup_schema()`。
返回结构（**失败也不许抛异常**）：
- 成功：`{"url", "title", "content", "raw_content", "metadata":{"sourceURL", "title"}}`
- 失败：`{"url", "title": "", "content": "", "error": "..."}`

## 免密钥环（本机制的核心）

`plugins/web/keyless_mcp.py`：

- `_KEYLESS_RING = ("exa", "parallel", "firecrawl", "keenable")` —— **元组**
- `_KEYLESS_EXTRACTORS: Dict[str, Callable[[List[str]], List[Dict]]]` —— **字典**，签名 `(urls) -> List[Dict]`
- `extract_with_failover(name, urls)` —— 只有当**整批 URL 全部返回“限流型”错误**时才跳到环里下一个 vendor（单个页面 403/404 属页面问题，不触发切换）
- `_ring_order(name)` —— 被 config 点名的 vendor 视为 pinned（从它开始轮转）；`provider_tier(v) == "paid"` 的会被过滤掉
- `provider_tier(name)` 读 `web.provider_tier.<name>`，未配置返回 `"auto"`（**保留在环内**）

**把本地提取器接到环末位**（运行时注入，不改源码）：

```python
import plugins.web.keyless_mcp as km
km._KEYLESS_RING = tuple(km._KEYLESS_RING) + ("local",)   # 元组必须重新赋值
km._KEYLESS_EXTRACTORS["local"] = local_extract_batch      # 字典直接 setitem
```

写成幂等函数，在插件 `register()` 里调用即可（`register()` 早于任何 web 调用）。

## 启用与生效

- `plugins.enabled` 是**白名单（opt-in）**：bundled 插件不受限，**用户级插件必须显式启用**
- `hermes plugins enable <name> --no-allow-tool-override`（不替换内置工具就加这个参数，跳过确认）
- `hermes plugins list` 查看状态（`user` / `bundled` 来源列）
- enable 后日志出现 `Gateway reloaded plugins`，但**当前长驻会话进程不生效**（输出提示 `Takes effect on next session`）——**下一条新会话**才用上新注册表
- 想强制走某后端：`hermes config set web.extract_backend <name>`（改前先备份 config）

## 跨 profile 同步（把一个 profile 的检索能力复制给另一个）

用户级插件、`.env` 凭据、`skills/` **全部按 profile home 隔离**：主 profile 的 `~/.hermes/plugins/` 对 `profiles/<name>/` 完全不可见。实测对照：default `Plugin discovery complete: 82 found, 73 enabled`，weixin 仅 `57 found, 52 enabled`——差的正是用户级插件。同步清单：

1. **插件目录**：`mkdir -p profiles/<name>/plugins && cp -a ~/.hermes/plugins/<plugin> profiles/<name>/plugins/`，删掉 `__pycache__`。**VPS 上未必装了 `rsync`**，`cp -a` 更稳。
2. **目标 profile 的 config.yaml**：`plugins.enabled` 追加插件名。它是**增量**语义——`enabled: []` 并不禁用其它插件（实测补一个后计数 57→58）；`entries.<plugin>.allow_tool_override: false` 一并搬。
3. **`.env` 凭据**：共用兜底钥（如 `TAVILY_API_KEY`）要**各存一份**；比对一致性只输出指纹 `sha256sum | cut -c1-16`，**绝不回显明文**。
4. **技能副本**：profile 的 `skills/` 是独立副本，逐个 `cp` 后 `cmp -s` 校验，否则会出现「配置是新的、技能还是旧的」。
5. **生效方式**：**不要重启 gateway**——multiplex 下会中断同进程承载的其它 profile。目标 profile 的 agent 进程按需拉起并重读配置，日志每几分钟出现一次 `Plugin discovery complete`，改完等 1–2 个周期即生效。
6. **验证口径**：`hermes -p <profile> plugins list | grep <plugin>`（enabled / 来源 user）、`hermes -p <profile> plugins doctor <plugin>`（`OK: ... registration passed`）、以及 `HERMES_HOME=~/.hermes/profiles/<name> venv/bin/python` 里读 `keyless_mcp._KEYLESS_RING` 与 `web_search_registry.get_active_search_provider()` 做端到端抓取/搜索实测。

## 验证方法（禁止凭猜）

1. **本地注入 + 打桩模拟限流**：把环里所有远程 vendor 替换成返回 429 的 lambda，再调 `km.extract_with_failover("exa", urls)`，看是否落到本地且拿到正文
2. **看日志**：`search_files(pattern="local_extract|<你的插件名>", path="~/.hermes/logs")` —— 应见 `registered web provider` 与环扩展两行
3. **端到端**：临时 `extract_backend=<你的 provider>` 跑一次 `web_extract`，**用完立刻改回**（否则旧会话立即报错）

## 坑（都踩过）

1. **trafilatura 2.x 需要 `lxml_html_clean`**：新版 lxml 把 `html_clean` 拆成独立包，只装 `trafilatura` 会 `ImportError: lxml.html.clean module is now a separate project`
2. `_KEYLESS_RING` 是**元组**（不能 setitem，要 `tuple(...) + (...)`）；`_KEYLESS_EXTRACTORS` 是**字典**（可 setitem）
3. 插件目录名带连字符（`web-local-extract`）**不是合法包名**，插件内部不要 `from web_local_extract...` —— 把逻辑放单文件 `__init__.py`
4. 把 `web.extract_backend` 改成自定义 provider 后，**旧会话立刻报 `no registered web extract provider has that name`** —— 所以默认应让自定义 provider 只做**环末位兜底**，而不是抢占 `extract_backend`
5. **不要改安装树**（`tools/web_tools.py`、`plugins/web/keyless_mcp.py`）：`hermes update` 会覆盖；运行时注入才是升级安全的做法
6. venv 被升级重建后要重装依赖：`venv/bin/pip install trafilatura lxml_html_clean curl_cffi`

## 决策：插件 vs 改核心

| | 用户级插件 | 改安装树 |
|---|---|---|
| 升级存活 | ✓ | ✗（被覆盖） |
| 能扩展免密钥环 | ✓（运行时赋值） | ✓ |
| 需要重启网关 | 否（新会话生效） | 否 |
| 可回滚 | 删目录 / disable | 需 git checkout |

## 现成实例

`~/.hermes/plugins/web-local-extract/` —— 本地正文提取（Trafilatura + curl_cffi Chrome TLS 指纹），注册为 `local_extract` provider 并挂在免密钥环末位。抓取优先 `curl_cffi`（`impersonate="chrome"`），退化到 `trafilatura.fetch_url`；`trafilatura.extract(html, favor_recall=True, include_tables=True)`。
