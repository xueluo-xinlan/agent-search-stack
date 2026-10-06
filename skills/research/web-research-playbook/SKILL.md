---
name: web-research-playbook
description: "Use when gathering web info: search-extract-browser ladder."
version: 1.6.0
author: Hermes Agent
license: MIT
platforms: [linux, macos, windows]
metadata:
  hermes:
    tags: [Web, Search, Research, Fetch, Extraction, Backends]
    category: research
    related_skills: [grounded-citations, blocked-page-recovery, rss-feeds]
---

# 网络信息收集作战手册

## When to Use

- 需要从网上查资料、核实事实、收集多源信息时。
- 搜索结果质量差 / 速度慢 / 抓不到正文时。
- 需要决定「该去哪些网站找」时（见下方分领域站点优先级）。
- `web_search` / `web_extract` 报错或返回空时，直接跳到「排障」段。

## 搜索/抓取组件角色表（2026-10-06 升级 98 提交后实测）

**`web_search` 已切 Nous 托管 Perplexity；其余组件一件没坏，只是角色变了。**

| 组件 | 当前角色 | 关键约束 |
|---|---|---|
| `web_search`（工具） | **主力** = Nous 托管 **Perplexity**（免费、无速率限制） | fast tier 对**所有 Nous 身份**开放、**无付费校验**（源码 `resolve_free_search_gateway`）；token 失效**自动落 Tavily** |
| `web_extract`（工具） | **主力** = Exa **匿名免费档**；**限流时自动落本地 Trafilatura**（免密钥环末位） | 与 `~/exa_search.py` 同端点；本地兜底见下方专节 |
| **Tavily**（`TAVILY_API_KEY`，在 `~/.hermes/.env`） | **兜底第一级**（autodetect 链首位） | **唯一的独立密钥通道 → 不要删** |
| **A-lite SearXNG（8890）** | **降级**：已不在 `web_search` 链上，**只服务 MCP `agent_search_gateway`** | **不能关**；`searxng-watchdog`（15m）、`searxng-hostnames-refresh`（每日 04:14）仍需跑 |
| `~/source_search.py` 与 MCP `source_search` | 不变（直连官方 API，不读 config） | — |
| B2（PC SearXNG） | 不变（中文 / 住宅 IP 备选） | — |
| cron 任务（5 个） | **无一依赖搜索后端**（grep 实测零匹配） | — |
| messaging profile | 已同步为 Perplexity（同一套） | 两端一致 |

### ⚠️ 头号陷阱：`web.use_gateway: true` 对两种能力含义不同

| 能力 | 走 `use_gateway` 时落到 | 计费 |
|---|---|---|
| **search** | Perplexity fast | **免费** |
| **extract**（仅当走共享路径） | **Firecrawl** | **付费** |

→ **`web.extract_backend: exa` 这行绝对不能删**：现在没走付费，全靠它显式挡住共享路径。**删掉 = 抓正文自动变付费 Firecrawl。**

### 升级脆弱性与必测项

`hermes config set web.use_gateway true` 在旧版会警告 “not a recognized key”（schema 未收录，但 `read_selection()` 确实读它）。
**2026-10-06 升级 98 提交后实测：键仍生效**（两 profile 均 `search=perplexity` / `managed=True`，config 校验和升级前后一致）。
**每次升级后必测两件事**：① `web_search` 是否仍走托管；② `extract_backend` 是否还在（丢了就开始花钱）。

### 本地提取兜底（2026-10-06 新增，升级安全）

`web_extract` 的免密钥链现为 **Exa → Parallel → Firecrawl → Keenable → 本地 Trafilatura**。当前四个远程档**整批**返回限流错误时，自动落到本地提取（零成本、无限流、查询不出网）。

- 位置：`~/.hermes/plugins/web-local-extract/`（**用户级插件，升级不覆盖**）
- 依赖（装在 Hermes venv）：`trafilatura` + `lxml_html_clean` + `curl_cffi`
- 抓取策略：`curl_cffi`（Chrome TLS 指纹）优先 → `trafilatura.fetch_url` 退化
- 强制纯本地：`hermes config set web.extract_backend local_extract`（**旧会话会立即报 no registered provider**，用完改回）
- 机制、验证方法与坑详见技能 `hermes-web-provider-plugin`

## 铁律一：先选入口，再按阶梯升级

**入口选择（2026-10-04 立规；两端 SOUL 第 10 节 / 微信用第 9 节有同款条款）**：
- **技术 / 学术 / 事实定义类**（API 与库用法、报错排障、论文、概念、开源项目）→ **优先调 MCP 工具 `source_search`**（官方 API 直连，0.4–1.1s）。
- **撒网 / 时事新闻 / 中文社区口碑 / 找陌生站点** → `web_search`。`source_search` **不覆盖**新闻与中文社区，别滥用。
- `source_search` 需**新会话**或 `/reload-mcp` 后才进工具列表；**看不见它时**退回命令行 `~/source_search.py`（同一实现，只是入口不同）。

成本递增，能用低档解决就不上高档：

| 档位 | 手段 | 耗时 | 拿到什么 |
|---|---|---|---|
| 0 | MCP `source_search`（**技术/学术/事实类首选**；不可见时走 `~/source_search.py`） | 0.4–1.1s | 权威源条目：标题+摘要+链接 |
| 1 | `web_search`（**Nous 托管 Perplexity**；撒网/时事/中文社区） | 1–3s | 10–25 条标题+摘要 |
| 2 | `python3 ~/exa_search.py "查询" N exa\|parallel` | 1–3s | **正文片段**（可引用证据） |
| 3 | `web_extract`（Exa 免钥环，一次 ≤5 URL） | 1–3s | 整页干净 markdown |
| 4 | MCP `fetch`（A-lite 网关，Readability） | ~1s | 整页 markdown |
| 5 | `browser_exec` | 10–60s | 仅当需要登录/JS 渲染/点击/反爬时 |

**多数任务停在 0–3 档即可。** 只有登录墙、SPA、强反爬（知乎/小红书）才上第 5 档。

## 通道矩阵（2026-10-03 实测）

- 内置 `web_search` → **Nous 托管 Perplexity**（`web.use_gateway: true` + 不设 `search_backend`；2026-10-06 起）。**SearXNG 已不在该链上**，它现在只服务 MCP `agent_search_gateway`。A-lite 的引擎天花板（bing/yandex 之外全废）因此**不再影响 `web_search`**，但仍影响走 MCP 的那条通道。
- `python3 ~/source_search.py "查询" --lang zh|en [--sources a,b,c] [--limit N] [--json]` → **直连官方 API 的多源检索器**（wikipedia / hn / arxiv / so / github / crossref / ddg），0.4–1.1s 拿到高相关条目，**绕开已失效的 SearXNG 适配器**。中文技术/事实类查询首选它。
- 内置 `web_extract` → `web.extract_backend: exa`（免密钥环 `https://mcp.exa.ai/mcp`）。**SearXNG 只能搜索不能抽取**，若该配置被清空，web_extract 会直接报 “search-only backend”。
- MCP `agent_search_gateway_local`（A-lite，VPS 本地）→ 恒可用。
- MCP `agent_search_gateway`（B2，经 pc-link 到 PC SearXNG）→ **2026-10-04 已改造为「国内直连通道」**：`cn.bing.com` + `networks.direct_cn`，中文查询实测 10 条权威源（gov.cn/求是/清华社）。Clash mixed-port 若为 `7900`，须与 `settings.yml` 的 `outgoing.proxies` 同步（细节见下方专段）。

## 引擎实际可用性（2026-10-03 复测；判据必须三位一体）

**三条判据缺一不可**，只看 results 条数会吃到假信号：

1. `GET /config` → `engines[].enabled`：**到底启用了哪几个**（唯一权威清单）。
2. `GET /search?format=json&q=!<短名> ...` → 逐条结果的 `engines` 字段：**这结果真是谁出的**。
3. `unresponsive_engines`：被**拒绝**（429/CAPTCHA/access denied）、还是**静默零产出**。

```bash
# 1) 启用清单
curl -s http://127.0.0.1:8890/config | python3 -c "import sys,json;d=json.load(sys.stdin);print([e['name'] for e in d['engines'] if e.get('enabled')])"
# 2) 隔离复核（bang 生效时，结果的 engines 字段 = 该引擎本身）
curl -s --get --data-urlencode "q=!bing artificial intelligence" "http://127.0.0.1:8890/search?format=json"
```

> **A-lite 的 live 配置是 `/etc/searxng/settings.yml`**（`searxng.service`，systemd 系统服务）；`/opt/searxng/` 下那份只是上游模板，改它不生效。要增删引擎（例如补一个真能出结果的引擎来替代 360search/brave/google）改 `/etc/searxng/settings.yml` 的 `engines:` 后 `systemctl restart searxng`，改完**必须按三位一体判据复测**，不得只凭 `enabled: true` 宣布可用。

| 引擎 | /config | 实测（2026-10-03） | 状态 |
|---|---|---|---|
| `bing` | enabled | `!bing` → 10 条，engines={bing:10} | ✅ 中英文皆可，主力 |
| `yandex` | enabled | `!yandex` → 10–15 条 | ✅ 中英文皆可 |
| `360search` | enabled | **0 条且 unresponsive 为空** | ❌ 启用但零产出：落点 `www.so.com/s?q=` 对机房 IP 直接 302 跳验证页 → 适配器解析 0 条。中文复测同样 0，与查询语言无关 |
| `brave` | enabled | 0，`Suspended: too many requests` | ⏳ 限流，配 API key 可解 |
| `google` | enabled | 0，`Suspended: access denied` | ❌ 无 key 难解 |

**A-lite 的启用集只有这 5 个**（`/config` 实测），默认搜索 = bing + yandex ≈ 18–25 条真实结果。服务健康，但覆盖面就是这两个索引。

### ⚠️ 坑一：`engines=` 传未启用的引擎名会**静默回退默认集**

`engines=startpage` / `!baidu` / `!mojeek` 这类**未启用**的名字不报错，SearXNG 直接拿默认集（bing+yandex）出结果：实测 `!startpage` 返 10 条、`!baidu` 返 19 条，而结果的 `engines` 字段写的是 `{'yandex':10}` / `{'bing':9,'yandex':10}`——**这些引擎自己一条都没出**。

⇒ **只看「results>0」就下结论，会把「名字被忽略」误判成「这个引擎能用」。** 必须核对结果里的 `engines` 字段与 `/config` 启用清单是否对得上。

### ⚠️ 坑二：不要用裸 curl 判断引擎死活

用裸 `curl` 抓引擎首页（如 `curl https://yandex.com/search/?text=x`）会拿到 `showcaptcha`，据此判定「yandex 被封」是**完全错误的**——SearXNG 有自带引擎适配器（正确的 headers/POST 参数/cookie），裸请求被拦 ≠ 适配器失败。实测：裸 curl 说 yandex 封了，而 SearXNG 内部路径返回 10–15 条真结果。**判据只能是 SearXNG 内部路径的 results 数。**

## A-lite 引擎天花板（2026-10-04 实测：14 引擎矩阵）

**结论：机房 IP 下 A-lite 的真实可用面 ≈ bing + yandex。不要再指望扩大引擎池，要走直连 API。**

测试方法（可复现，且**不动生产**）：把 `/etc/searxng/settings.yml` 复制成 `/etc/searxng/test-settings.yml`（改 `port: 8891`、`use_default_settings.engines.keep_only` 扩到候选集、`debug`/`logging` 打开），用
`SEARXNG_SETTINGS_PATH=/etc/searxng/test-settings.yml PYTHONPATH=/opt/searxng SEARXNG_BIND_ADDRESS=127.0.0.1 /opt/searxng/.venv/bin/python /opt/searxng/searx/webapp.py`
起第二个实例，测完 kill 并归档测试配置。（注意：`logging:` 的正确 schema 是 `logging.root.level: DEBUG`，写错不报错但也不生效。生产的 searxng.service 读的是 `/etc/searxng/settings.yml`，测试实例不会影响它。）

| 引擎 | 中文查询 | 英文查询 | 日志证据 | 判定 |
|---|---|---|---|---|
| `bing` | 10 条，**但同一查询 4 连击里 2 次 0 条** | 8–10 条稳定 | 无异常、无 unresponsive、0.1s 返回 | ✅ 主力，但结果不稳定（见坑三） |
| `yandex` | 15 条 | 6–10 条 | 偶发 `engine timeout` | ✅ 主力，稳定 |
| `mwmbl` | 0 | 25–53 条 | `timeout`×2（分页请求部分失败） | ⚠️ 英文可出，但**拖慢 5s**，质量未知，生产未启用 |
| `wikipedia` / `wikidata` | 0 | 0 | **无任何日志行**（没走异常路径） | ❌ 适配器零产出。**但同一 API 裸请求 200**（zh/en 均 0.7s）→ 是 SearXNG 适配器的问题，不是网络 |
| `mojeek` | 0 | 0 | 无日志行 | ❌ 同上。裸 `curl mojeek.com/search` 反而 200 → **「裸抓通」≠「适配器通」** |
| `seznam` | 0 | 0 | `timeout`×2 | ❌ 超时 |
| `duckduckgo` | 0 | 0 | `SearxEngineCaptchaException` | ❌ CAPTCHA 墙 |
| `qwant` | 0 | 0 | `SearxEngineCaptchaException` | ❌ CAPTCHA 墙 |
| `baidu` | 0 | 0 | `SearxEngineCaptchaException` | ❌ CAPTCHA 墙 |
| `brave` | 0 | 0 | `TooManyRequests(429)` | ⏳ 限流 |
| `google` | 0 | 0 | `AccessDenied(403)` | ❌ 无 key 难解 |
| `360search` | 0 | 0 | 无日志行 | ❌ 启用但解析 0 |
| `startpage` | — | — | 该名字**未定义**，`engines=startpage` 静默回退默认集 | ❌ 名字不存在（见坑一） |

### ⚠️ 坑三：bing 对**中文查询**存在随机零产出（0.1s / 0 条 / 无任何异常）

实测同一查询 `大模型 微调` 连续 4 次：`10 / 0 / 0 / 10` 条；另一个 3 连击：`0 / 0 / 10`。零产出那几次 **耗时 0.1s**（连一次跨国 RTT 都不够），且 `unresponsive_engines` 为空、日志无 WARNING/ERROR —— 即**既不是超时也不是被拒**，SearXNG 直接没发请求。

⇒ 看到 bing 中文 0 条**不要**判定「被封 / 查询无结果」；**重试一次**多半就有。同理，单次 0 条不能作为任何结论的判据。

## 专用 API 直连源：`~/source_search.py`（2026-10-04 新增）

**为什么**：上表那些「适配器零产出 / CAPTCHA 墙」的站点，其**官方 API 直连全部可用**（实测状态码/耗时）：wikipedia zh/en `200/0.7s`、hn.algolia `200/0.36s`、arxiv `200/0.35s`（**必须 https**，http 会 301）、stackexchange `200/0.42s`、github `200/0.38s`、crossref `200/0.71s`、DDG Instant Answer `200/0.44s`；semanticscholar `429`（限流，需退避）、reddit `.json` `403`（不可用）。

**覆盖的源**：`wikipedia`（按 `--lang` 选 zh/en）、`hn`、`arxiv`、`so`（StackExchange）、`github`、`crossref`、`ddg`。默认集 = 除 ddg 外全部。

**按查询语言选源（实测经验）**：
- 中文技术查询（如「大模型 微调 显存」）→ `wikipedia,github,crossref` 最能出好结果（1.06s / 14 条）；`arxiv`/`hn`/`so` 对中文几乎无效（0–1 条且不相关）。
- 英文技术查询（如「lora fine-tuning vram」）→ `arxiv,github,so,hn`（1.10s / 14 条，arxiv 结果高度相关）。
- 中文事实/定义类 → `wikipedia,ddg`（0.71s）。

**用法示例**：
```bash
python3 ~/source_search.py "大模型 微调 显存" --lang zh --limit 4
python3 ~/source_search.py "lora fine-tuning vram" --lang en --sources arxiv,github,so
python3 ~/source_search.py "量子计算" --json | jq            # 结构化输出
python3 ~/source_search.py "量子计算" --save                  # 追加进 JSONL 归档，按 url 去重
```

**已注册为 MCP 工具**（2026-10-04）：`~/mcp_source_search.py`（纯 stdlib 的 JSON-RPC stdio server，暴露工具名 `source_search`），用 `hermes mcp add source_search --command /usr/bin/python3 --args ~/mcp_source_search.py` 注册（该命令会问 “Enable all 1 tools?”，非交互环境要 `yes Y |` 喂入）。登记后在**新会话**或执行 `/reload-mcp` 后才出现在工具列表。验证：`hermes mcp list` 应显示 `source_search … ✓ enabled / all`。

## 新增 MCP 后的生效路径（2026-10-04 实测）

改 `config.yaml` 加 MCP server 后，工具要跨两层才到手：

1. **服务端（自动）**：`mcp.auto_reload_on_config_change` 默认 true，网关会自动 reconcile，日志出现
   `gateway.run_profile_reconcile: MCP servers reconciled with config (<profile>): added=['…']` 和
   `MCP server '<name>' (stdio): registered N tool(s)`。这一步**不需要重启**。
2. **会话层（手动）**：工具表在会话构建时冻结，**已开的会话看不到新工具**，必须 `/reload-mcp` 或开新会话。

**判据纪律**：别用 `tool_describe('<工具名>')` 单独判定“能不能用”——它查的是延迟目录的快照，刷新不及时（本次就因此误判多轮）。**权威判据是 `tool_search` 返回里的 `available_sources` 清单**（已连接服务器的工具数），它列出的就是真到手的。

**各端触达方式**：
- **微信 / messaging 侧**：在对话里发 `/reload-mcp`，valid——成功后会在会话里注入一条系统通知
  `[IMPORTANT: MCP servers have been reloaded. Reconnected servers: …, N MCP tool(s) now available.]`（可直接从 state.db 读出来做铁证）。
- **桌面端**：同样发 `/reload-mcp`；但**旧版桌面 app 的斜杠命令表里可能没有这个命令**（在输入框打 `/` 看补全菜单即知）。没有入口时只能：开新会话，或 `systemctl --user restart hermes-serve.service`（会断连接）。直接调本地 `/api/ws` 的 `reload.mcp` RPC 需要 dashboard 凭据，不带凭据 403、凭据不对 401。
- 两个进程各自维护 MCP 状态：`hermes-serve.service`（桌面端 9119）与 `hermes-gateway.service`（消息网关）互不同步，哪边要用就得在哪边 reload。
- **改了 MCP server 脚本后同样要 reload**：MCP 子进程是常驻进程，已 import 的模块不会热加载——改 `~/source_search.py` 后，若 `ps -eo pid,lstart,cmd | grep mcp_source_search` 的启动时间早于 `stat -c %y ~/source_search.py`，就是仍在跑旧代码（2026-10-04 实测）。`hermes mcp` **没有** reload 子命令，只能 `/reload-mcp` 或重启宿主 service。

**两个 profile 都已注册**（2026-10-04）：default 写在 `~/.hermes/config.yaml`；messaging 侧用 `hermes -p weixin mcp add ...`，写在 `~/.hermes/profiles/weixin/config.yaml`（回读 `hermes -p weixin mcp list` → ✓ enabled）。**每个 profile 的 config 独立，给一侧注册不会自动出现在另一侧**；两侧的工具描述文案默认取自 MCP server 的 `description` 字段（源脚本里写死，要改文案改 `~/mcp_source_search.py`）。

**查询写法要点（2026-10-04 实测修正，脚本内已实现）**：

- **wikipedia 必须「标题命中优先」**：中文维基走 CirrusSearch 分词，多词查询 `A B` 被拆成独立词项，`零知识证明 基本原理` 会返回《纯粹理性批判》《狭义相对论》这类只命中「基本原理」的条目，真正相关的词条反被挤出榜单。脚本对策：先用 `intitle:"主概念段"` 让命中排前（中文只取最长的**中文段**——弱限定段如「基本原理」会引入「世界語基礎」噪声，故不逐段并发），再用原样全文查询补齐；整串零命中时才逐段 `intitle` 兜底。命中项 meta 带 `标题命中 · ` 前缀，便于判读。
- **arxiv 多词必须加引号**：`all:zero knowledge proof` 把空格当词项拆分，返回 LLM/知识图谱等无关论文；`all:"zero knowledge proof"` 三条全中（脚本已用短语 + 零命中回退原样）。
- **英文长串在 en 维基常整串零命中**（`lora fine-tuning vram` → 0 条，AND 语义），此时逐段兜底会给出 `LoRA (machine learning)` —— 别把「wikipedia 0 条」当成查询无解。
- 边界：`intitle:` 前会剥掉引号/反斜杠；`--limit` 很小时标题优先的效果最明显。

**实现要点（改脚本时别踩）**：所有源并发（ThreadPoolExecutor），单源失败只填 `error` 不拖累整体；`Accept-Encoding: gzip` 必须自己解压（StackExchange 返回 gzip）；摘要/标题要 `html.unescape` 后再剥标签，否则 `&quot;` / `&#x27;` 会原样进上下文；arXiv 标题**不要**用 `"".join(split())` 去空白（会把词粘成一串）。

## 低质结果防线（2026-10-04 已落地）

历史上 SearXNG 结果里混入过成人站域名 → 该字符串随工具输出落库 → 之后**每轮请求**都被上游内容审核拒（`finish_reason=content_filter`），会话被毒化。现已在服务端做两道防线：

1. `search.safe_search: 2`（`/etc/searxng/settings.yml`，**2026-10-04 已从 0 改为 2**）。
2. `hostnames.remove: 'hostnames-remove.yml'`（SearXNG 的 hostnames 插件，把命中域名从结果的**标题/摘要**里抹掉）。清单 63887 条，由 `/usr/local/bin/searxng-hostnames-refresh.py` 生成（拉 StevenBlack hosts 的 unified/porn 差集 + 外置词根种子 `/etc/searxng/hostnames-seeds.json`），`searxng-hostnames-refresh.timer` 每日 04:10（+随机 600s）重建并重启 searxng。
3. 搜索网关侧：`/opt/agent_search_gateway/gateway.yaml` 的 `ad_filter.level: ads+porn`。

**回归检测**：按域统计检查（只看条数/引擎名/命中计数，**永不打印 URL、标题、域名**，避免二次污染）。这是会话级临时件，未随仓库提供；等价判断可直接看 `vps/mcp_probe.py` 输出的 `unresponsive_engines`。

**写扫描器必看的两条（已踩过）**：
- `hostnames-remove.yml` 里装的是**正则**（形如 `(.*\.)?xxx\.com$`），**不是裸域名**。拿裸域名逻辑去 `fullmatch` 会得到 0 命中 —— 那是**假阴性**，不是「库很干净」。必须先还原成域名片段再匹配（见 `session_poison_scan2.py`）。
- **判据上线前先自测**：从清单里取一条，构造它必然命中的样本串，验证管线真的会命中；自测失败 → 判据坏，此时任何「0 命中」结论都不成立。

**会话中毒的处置**：`state.db` 的 `messages` 表把命中消息置 `active=0` 软归档（原文保留、不回放、不进搜索）。注意：**自己在 reasoning 里举一个成人站域名就等于亲手投毒** —— reasoning 同样落库并随请求回放给上游内容审核。

**操作纪律**：含域名的清单类文件**永不阅读、永不 grep、只看 `wc -l` 规模**；脚本内可 in-memory 加载做匹配，但绝不 print。任何输出前先脱敏。

## B2（PC SearXNG）= 国内直连通道（2026-10-04 改造完成）

**定位：只做 A-lite 做不到的事 —— 用住宅 IP 直连国内站。国外引擎交给 A-lite。**

配置要点（`C:\Users\you\Projects\searxng\searx\settings.yml`）：
- `outgoing.proxies: all:// → http://127.0.0.1:7900`（Clash mixed-port，**不是 7897**；2026-10-03 被改过，改端口必须同步这里）
- `outgoing.networks.direct_cn: {proxies: null}` ← 直连网络（覆盖全局代理）
- `bing`：`base_url: https://cn.bing.com` + `network: direct_cn` → ✅ 实测 **10 条中文权威源**（gov.cn / 求是 / 清华社 / 百度百科）
- `360search`：`network: direct_cn`，但**恒 0**（见下）
- `request_timeout: 6.0` + `extra_proxy_timeout: 5`（**原 3.0 太短**：走代理的引擎全部 timeout，还伴生 SSL 校验错误假象）

### SearXNG 按引擎分流代理的正规语法（源码 `initialize()` 确认）

```yaml
outgoing:
  proxies:
    all://: [http://127.0.0.1:7900]
  networks:
    direct_cn:
      proxies: null          # 该网络强制直连（覆盖全局）
engines:
  - name: bing
    engine: bing
    network: direct_cn       # 引用上面的网络
```

`new_network = default_params + params`，后者覆盖，所以 `proxies: null` 即直连。`proxies` 本身只按 URL 模式匹配，**不支持按引擎名**——按引擎分流必须用 `networks`。

### ⚠️ 反爬墙：SearXNG 自身过不去（对策见下节「三档递进」）

- 这类墙**不是「无解」**：2026-10-04 起第 1.5 档已实测可过 Cloudflare 交互式挑战（见下节）。SearXNG 用 curl_cffi 过不去是**工具层**限制，不等于目标站抓不到。
- `360search`／`baidu`：**302 → `qcaptcha.so.com` / `wappass.baidu.com/.../captcha`**；换 UA（浏览器/curl）、换 IP（住宅/代理/机房）、直连/代理——**结果完全相同**。这是**图形/JS 验证码墙**，SearXNG 用 curl_cffi（无 JS 引擎、无验证码求解）**过不去**。
- 要过墙只有两条路：① 浏览器级方案（Playwright / FlareSolverr + 持久化 cookie，首次人工过一次，QiHooGUID 有效期约2年）；② 换有 API 的国内搜索（如**博查 Bocha**，国内服务、无需外国卡）。
- **但多数时候不必过墙**：`cn.bing.com` 直连已能拿到同等甚至更权威的中文源（gov.cn/求是/清华社）。

## 反爬三档递进（2026-10-04 落地；第 1.5 档实测可过 Cloudflare）

链路由 PC 侧 `C:\Users\you\agent_search_gateway-master\gateway.yaml` 内建，本技能只记录如何维持与验证：

```yaml
flaresolverr:
  url: http://127.0.0.1:8191
  enabled: true                    # 已开
  trigger_status: [403, 405, 429]  # direct 命中 → 升级
  fallback_on_empty: true          # direct 200 但空壳 JS → 也升级
browser:
  enabled: true                    # 第 2 档：内嵌 playwright
  engine: chromium
```

| 档 | 手段 | 触发条件 | 现状 |
|---|---|---|---|
| 1 | direct HTTP | 默认 | ✅ |
| **1.5** | **FlareSolverr 兼容层**（PC `127.0.0.1:8191`） | direct 403/405/429，或 200 空壳 | ✅ 2026-10-04 起在用 |
| 2 | 内嵌 playwright（chromium，headless） | 前两档都不行 | ✅ 配置已开 |
| 3 | 人工（`browser_vault` / `computer_use`） | 登录墙、reCAPTCHA | 手动作业 |

**第 1.5 档的实现**：仓库 `pc/flaresolverr-compat/pc_flaresolverr_compat.py`（本机部署在 `C:\Users\you\flaresolverr_compat\`）
——自研最小实现（**byparr 在 PyPI 上查无此包**，别再去装），用系统 Edge + playwright，单线程串行 + 常驻浏览器上下文（首次请求惰性拉起）。API 与 FlareSolverr 对齐：`POST /v1 {"cmd":"request.get","url":…,"maxTimeout":ms}`、`GET /health`。
常驻方式：计划任务 `FlareSolverrCompat`（`/sc onlogon`）→ 调 `start_flaresolverr_compat.bat`（11 目录内，日志同目录 `flaresolverr_compat.log`）。

**验证三条（缺一不可）**：
1. 本地健康：`curl -s http://127.0.0.1:8191/health` → `{"status":"ok",…}`（在 PC 上跑）
2. 端到端过墙：`python pc_test_flaresolverr.py` → 抓 `https://nowsecure.nl/`（Cloudflare 交互挑战测试站）应得 `status=ok http=200` 且页面上**无** challenge 残留（实测 179818 字节 / 12.88s）
3. 网关联动：MCP `agent_search_gateway` 的 `health` → `flaresolverr: {"status":"up"}`；再用它的 `fetch` 抓均同站应返回正文 markdown

**判据纪律（已踩）**：
- `/api/plugins/*` 的 **401 不能判断插件是否挂载** —— 不存在的插件名同样 401（auth 中间件先拦）。权威判据是 `~/.hermes/logs/gui.log` 里的 `Mounted plugin API routes: /api/plugins/<id>/` 行。
- 重载 `hermes-serve.service` **必须带** `XDG_RUNTIME_DIR=/run/user/0` 与 `DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/0/bus`，否则 `systemctl --user` 报 `Failed to connect to bus: No medium found`（用 `systemd-run` 排的定时器最易漏：命令里的 `systemctl` 不继承你的 shell 变量，要写成脚本再排）。

## 后端开关：默认锁免费档，额度后端由用户手动开（`~/web_backend.sh`）

- `status` 看当前用哪家、谁配了密钥；`quota` 查 Tavily 本月用量。
- `on <tavily|brave|exa|parallel> [extract]` 开启额度后端；`off` 回免费档（搜=searxng、抓=exa）。
- **铁律：绝不在用户没要求时开启额度后端。** 用户说「用 Tavily/Brave 搜」→ 先 `on`，用完问一句要不要 `off`。
- 为何 off 必须显式写 `search_backend: searxng`：Hermes 自动检测顺序里 Tavily/Exa 排在 SearXNG 之前，`.env` 里一旦有 key，留空（=自动检测）就会静默漂移过去——那就不是「用户选择开不开」了。
- `extract` 不能指向 `brave-free`：Brave 只有搜索能力，无抓取。
- 密钥存放：Tavily → `TAVILY_API_KEY`、Brave → `BRAVE_SEARCH_API_KEY`，写入 `~/.hermes/.env`（600）。

## tvly CLI（Tavily 官方命令行，本地已装）

位置：`/usr/local/bin/tvly` → `/opt/tvly-cli`（独立 venv，不动系统 Python）。版本 `tavily-cli 0.1.8`。

| 命令 | 是否需要 key | 用途 |
|---|---|---|
| `tvly search "q" --json` | 免钥可用（有速率上限） | 搜索，返回结构化正文片段 |
| `tvly extract "url" --json` | 免钥可用（有速率上限） | 干净正文抽取 |
| `tvly map "https://site" --json` | **需 key** | 站点 URL 地图（Hermes 无此能力） |
| `tvly crawl "https://site" --output-dir ./d/` | **需 key** | 批量抓整站/整栏目（Hermes 无此能力） |
| `tvly research "topic" --json` | **需 key** | 多源引用研究报告，`--model pro` 加强（Hermes 无此能力） |

升级：`/opt/tvly-cli/bin/pip install -q -U tavily-cli`。

### 认证（重要约束）

无 GUI 机器上的 OAuth **走不通**：`tvly login --no-browser` 的回调是 `http://127.0.0.1:<随机端口>/callback`，浏览器在用户本地时才解析得到，云服务器上无法完成。

可行路径只有密钥直传：

```bash
tvly login --api-key tvly-XXXX          # 认证 CLI（凭据存 ~/.tavily/config.json）
# 或一步到位（不装它家 Agent Skills，因为 --agent 只认 claude-code/codex/cursor，无 hermes）
tvly init --api-key tvly-XXXX --skip-skills --yes
```

Hermes 自己用的是另一个通道：把同一个 key 写进 `~/.hermes/.env` 的 `TAVILY_API_KEY`，再用 `web_backend.sh on tavily` 开关。**两边共用同一个 key 即可**。

### 不要装它的 Agent Skills

官方 skill 安装器的 `--agent` 只支持 `claude-code|codex|cursor`，**没有 Hermes**。硬装只会往磁盘上扔一份 Hermes 永远不会加载的文件。Hermes 侧的能力靠本技能记录 + `web_backend.sh` 完成。

## 下结论前的自检四问（因两次误判立规）

任何「X 可用 / X 不可用 / X 全废」的结论落笔前，逐条过：

1. **判据问**：我量的是目标本身，还是替身？（裸 curl 首页 ≠ 引擎适配器路径；results 条数 ≠ 该引擎出的条数）替身只能证伪，不能证真。
2. **反证问**：我自己已有数据里有没有相反证据？（当时 `unresponsive` 里根本没有 yandex，却宣布 yandex 被封）
3. **范围问**：结论的适用范围是否等于数据的适用范围？（拿 5 个引擎的观测外推成「公共搜索被机房 IP 全封」＝ 过度泛化）
4. **机制问**：零产出是**被拒绝**、**没发请求**、还是**发了没人用**？（360search 是「启用但解析 0」，与「被封」是两码事，处置完全不同）

## 已验证的坑

1. **bing 中文查询随机 0 条**（0.1s、无 unresponsive、无日志）→ 重试即可，别急着判定「被封」。详见「坑三」。
2. **「裸 curl 通」不能证明「SearXNG 适配器通」**：mojeek / wikipedia 裸请求 200，但适配器零产出；反之 yandex 裸请求吃 CAPTCHA，适配器却稳定出 15 条。两者必须分开量。
3. **B2 的 health 不可信**：探针只测 SearXNG 的 HTTP 200，代理已死时它照样报 `status: up`。真正的判据是 search 返回体里 `unresponsive_engines` 是否全 timeout。要调 B2 前，宁可先用 A-lite。
2. **urllib 直调 `mcp.exa.ai` / `search.parallel.ai` 必须带 `User-Agent`**，否则 Cloudflare 直接 403（curl 默认 UA 能过，urllib 默认 UA 不行）。
3. `web_extract` 超出 char_limit 的正文会落盘，用 `read_file` 续读被省略的中间段，不要重复抓。
4. Exa 偏英文/语义；中文查询用 SearXNG（360search）或 Parallel，实测中文正文质量 Parallel > Exa。
5. 时效性问题要在查询里带年月，或走 news 类目；通用检索的排序对时间不敏感。
6. 改 `~/.hermes/config.yaml` 会被 Hermes 拒绝（安全保护），必须走 `hermes config set <key> <value>`；改完**即时生效**，无需重启网关（web 工具每次调用重读配置）。
7. **`request_timeout` 是丢结果的隐藏闸门**：A-lite 设 `5.0s` 时，bing 英文查询实测常跑到 `5.1s`、日志里出现 `engine timeout`。慢查询前先用单引擎跑一次看耗时，再决定是否值得调大（调大同样拉长最坏延迟，别盲调）。
8. **实验引擎不要动生产配置**：复制 `settings.yml` → 改 `port`/`keep_only` → 用 `SEARXNG_SETTINGS_PATH` 起第二个实例（见「A-lite 引擎天花板」），测完 kill + 归档，不碰 `searxng.service`。

## 分领域站点优先级

- **技术/API/库**：官方 docs → GitHub（README / release notes / issues）→ Stack Overflow → Hacker News → 掘金/CSDN（仅参考，质量参差）
- **AI/模型**：arXiv → 官方 blog → HuggingFace → Papers with Code
- **产品/价格**：官网/store → 京东/淘宝 → 什么值得买 / Reddit
- **新闻时事**：Reuters / AP / BBC / 新华社 / 澎湃
- **中文口碑**：V2EX、知乎（要登录 → browser）、B站评论区、小红书（强反爬）
- **学术**：arXiv、Semantic Scholar API、Google Scholar（反爬）
- **事实/时间线**：Wikipedia

## 电商平台可达性（2026-10-04 实测；做比价/现货/规格调研前先读）

**强制登录 ≠ 反爬，是业务规则。** FlareSolverr 能过 Cloudflare，但**过不了登录墙**。下表为**无登录态**下实测：

| 平台 | 搜索页 | 详情页 | 备注 |
|---|---|---|---|
| **苏宁易购** | ✅ `search.suning.com` 可读 | PC `product.suning.com` **302 登录**；**换 `m.suning.com/product/<vendor>/<sku>.html` 200 可读** | 唯一免登录可抓的综合电商 |
| 淘宝 | ❌ 302「亲，请登录」；`s.m.taobao.com/search` **404**（接口已废弃） | ❌ | `bk.taobao.com` 亦 302 `login.taobao.com/havanaone` |
| 京东 | ❌ 302 → `plogin.m.jd.com`（PC 与 `so.m.jd.com` **移动端同**） | ❌ 403 频控 | `p.3.cn` 价格接口被网络层拦（ERR_CONNECTION_CLOSED） |
| 小红书 | ❌「登录后查看搜索结果」 | ❌ | 笔记页同样强制登录 |
| 拼多多 | ❌ 302 → `mobile.yangkeduo.com/login.html` | ❌ | |
| 1688 | ❌ 搜索跳登录 | ⚠️ **详情页可抓**（乱码需 latin1→utf-8 还原） | |
| 抖音 | ❌ | ❌ | |
| 什么值得买 | ✅ | ✅ | 免登录，社区帖可直接读；但**广告/厂家投放内容多，引用前须甄别** |

**铁律一：不要把「苏宁可用」外推成「电商换移动端就能抓」。** 除苏宁外，各平台移动端与 PC 端**同为登录墙**。苏宁是**特例**（其 m 站未做登录拦截）。这是「范围问」的典型案例：局部观测不得抬升为通例。

**铁律二：判定「是否已登录」要看凭据字段，不是看 cookie 数量或名字存不存在。**
- 京东真凭据：`pt_key` / `pt_pin` / `thor`。只有 `__jda~__jdu`、`shshshfp*`、`areaId` = **访客态**（这些是设备标识）。
- 淘宝真凭据：`_nk_` / `unb` / `cookie17` / `sgcookie`。只有 `_tb_token_`、`_m_h5_tk` = **访客态**（访客 H5 token）。
- `passport.jd.com` 出现 `qr_p` / `QRCodeKey` = 打开过扫码页但**未完成**扫码，**不等于**已登录。
- 扫 cookie 库前先 `shutil.copy2` 拷出来再只读打开（原文件被浏览器锁定）。

**铁律三：用户有登录态 ≠ 抓取兼容层会用它。** PC 的 FlareSolverr 兼容层 `_ensure_context()` 用 `browser.new_context()`（**全新无 cookie 上下文**）。要带登录态必须改成 `launch_persistent_context(user_data_dir=<profile 路径>)`，且启动前关掉占用该 profile 的 Edge 进程。**只让用户登录、不改兼容层 = 白做。**

**抓到的页面乱码**：`raw.encode('latin1').decode('utf-8')` 还原（1688 及部分 m 站命中）。

**判据纪律**：本节所有「❌ 不可用」均由**实测 302 跳转**得出，非「没搜到」反推；反之「苏宁可用」仅指**免登录读取公开商品页**，不代表可下单或能看真实库存。

## 查询技巧

- 用 `site:`、`filetype:pdf`、`intitle:` 收窄（SearXNG 支持这些算子）。
- 中文技术问题搜两遍：中文关键词一遍（CSDN/掘金向），英文关键词一遍（官方文档向）。
- 「怎么做 X」「X 报错」这类语义型问题，优先 `exa_search.py`——它直接返回正文片段，省掉一轮抓取。
- 一次 `web_extract` 传多个 URL（≤5）并发抓，比逐个抓快得多。

## 排障

```bash
# 0. 三条通道体检
python3 ~/mcp_probe.py local "测试查询"     # A-lite（VPS，恒可用）
python3 ~/mcp_probe.py pc    "测试查询"     # B2（PC，看 unresponsive_engines）
python3 ~/exa_search.py "test" 3 exa        # 免密钥环
# 1. VPS SearXNG 本体
curl -s "http://127.0.0.1:8890/search?q=test&format=json" | head -c 300
# 2. PC 侧代理是否活着（B2 搜索空的主因）
ssh -S /run/pc-link.sock -p 2222 -o BatchMode=yes wei@127.0.0.1 "netstat -ano | findstr :7900"
```
