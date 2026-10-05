# agent-search-stack

自托管的 **搜索 + 信息抓取** 完整栈：直连官方 API 的多源检索、免密钥抓取降级环、本地正文提取兜底、SearXNG 元搜索后端，以及把这一切封装成 MCP 工具的轻量网关。

> 面向低配服务器（≈4GB）与小内存 Agent 环境设计：全自托管、无强依赖、无强制注册。

---

## 它解决什么问题

1. **机房 IP 下公共搜索引擎适配器大面积失效**——CAPTCHA、403/429、静默零产出。实测：SearXNG 的 wikipedia / wikidata / mojeek / 360search 零产出，duckduckgo / qwant / baidu 被 CAPTCHA 拦，google / brave 403/429；而**同一批站点的官方 API 直连全部 200，耗时 0.3–1.1s**。于是按「站点定位」直连 API，比走元搜索更快、更准、更稳。
2. **抓取链路需要「无密钥也能用」**——远程免密钥档（Exa / Parallel / Firecrawl / Keenable）会限流；为此补一层**本地解析兜底**（Trafilatura + curl_cffi），零成本、无限流、查询不出网。
3. **抓取能力需要跨进程复用**——同一套能力既给 CLI 用，也给 MCP client（Hermes Agent / OpenCode / 任意 MCP host）用。

---

## 架构

```
Agent（Hermes / OpenCode / 任意 MCP client）
 ├─ MCP 工具 source_search ─► vps/mcp_source_search.py ─► vps/source_search.py
 │                                                          └─► Wikipedia / HN(Algolia) / arXiv
 │                                                              StackExchange / GitHub / Crossref / DDG
 │                                                              （各自官方 API，直连，带摘要）
 ├─ 联网检索 ─────────────► SearXNG (:8890)  ─► bing / brave / google / yandex / 360search
 ├─ 正文抓取 ─────────────► 免密钥降级环： Exa → Parallel → Firecrawl → Keenable → 本地解析
 └─ 统一网关（MCP over HTTP, :3000）─► searxng / FlareSolverr / 内嵌 playwright（复杂 SPA）
```

抓取降级环的关键设计：**只有当一批 URL 全部返回「限流形状」的错误时才前进到下一档**；部分失败、403 等页面级问题原样返回，不误判为节流。

---

## 组件

| 路径 | 说明 |
|---|---|
| `vps/source_search.py` | 多源直连检索 CLI：wikip/hn/arxiv/so/github/crossref/ddg，0.4–1.1s 返回带摘要条目；支持 `--json`、`--save`（JSONL 归档 + 按 URL 去重） |
| `vps/mcp_source_search.py` | 纯标准库的 MCP stdio server，把上面那个暴露为工具 `source_search` |
| `vps/exa_search.py` | 免密钥检索器：Exa / Parallel 的公开 MCP 端点，直接拿「正文片段」级证据 |
| `vps/hermes-plugin-web-local-extract/` | Hermes 用户级插件：注册 `local_extract` web provider，挂在免密钥环末位（Trafilatura + curl_cffi Chrome TLS 指纹） |
| `vps/web_backend.sh` | 后端开关：默认锁免费档，付费档手动开/关（避免「key 一存在就自动漂移」） |
| `vps/mcp_probe.py` | 后端探针：分别打本地 / 远端通道，输出条数与 `unresponsive_engines` |
| `gateway/` | 统一搜索/抓取网关（TypeScript，MCP over HTTP）：search / fetch / browser_* / health，fetch 智能路由 direct → FlareSolverr → playwright |
| `searxng/` | SearXNG 配置示例与 systemd 单元（含定时重建域名过滤清单的服务） |
| `skills/` | 把这些做法沉淀成的操作手册（含踩坑与验证方法） |

---

## 快速开始

```bash
# 1) 多源直连检索（仅标准库，无需安装依赖）
python3 vps/source_search.py "零知识证明 基本原理" --lang zh --limit 4
python3 vps/source_search.py "lora fine-tuning vram" --lang en --sources arxiv,github,so,hn
python3 vps/source_search.py "量子计算" --json | jq          # 结构化
python3 vps/source_search.py "量子计算" --save                # 追加 JSONL 归档并按 URL 去重

# 2) 免密钥正文片段（Exa / Parallel 公开端点）
python3 vps/exa_search.py "SearXNG braveapi engine config" 3 exa
python3 vps/exa_search.py "2026 GPU 推荐" 5 parallel
```

**注册为 MCP 工具**（stdio）：

```json
{ "mcpServers": { "source_search": { "command": "python3", "args": ["/abs/path/vps/mcp_source_search.py"] } } }
```

**安装本地提取插件**（Hermes）：

```bash
mkdir -p "${HERMES_HOME:-~/.hermes}/plugins"
cp -a vps/hermes-plugin-web-local-extract "${HERMES_HOME:-~/.hermes}/plugins/"
hermes plugins enable web-local-extract --no-allow-tool-override
# 依赖（装在 Hermes venv 内）：
#   pip install trafilatura lxml_html_clean curl_cffi
```

**网关**：见 `gateway/README.md`；**SearXNG**：见 `searxng/settings.yml.example`（先把 `secret_key` 换成 `openssl rand -hex 32` 的输出）。

---

## 设计要点（均为实测结论）

- **直连 > 元搜索**：技术/学术/事实类查询走官方 API，返回权威条目且延迟低一个量级；时事/社区口碑仍交给元搜索。
- **降级环只在整批限流时前进**：避免把「页面 403」误判成「服务商限流」而白白降级。
- **本地兜底不抢主位**：`local_extract` 只做环末位兜底，不改 `extract_backend`，因此不会让旧会话立刻报 `no registered provider`。
- **显式锁档**：付费后端的 key 一旦存在于环境变量，自动检测链会主动漂移；用开关脚本显式锁定 `searxng`（搜索）/ `exa`（抓取），要开付费档必须手动。
- **结果污染防控**：SearXNG 开 `safe_search: 2` 并挂 hostnames 移除清单；清单由每日定时任务重建（清单本身不入库，见 `docs/SECURITY.md`）。

---

## 安全

- 仓库内**不含任何密钥**；所有凭据通过环境变量注入（`TAVILY_API_KEY` / `BRAVE_SEARCH_API_KEY` / `EXA_API_KEY` …）。
- `.gitignore` 屏蔽 `.env`、实例配置（`gateway.yaml`）、`node_modules/`、构建产物与域名过滤清单。
- 详见 `docs/SECURITY.md`。

## 许可

MIT —— 见 `LICENSE`。第三方依赖许可见 `gateway/THIRD_PARTY_LICENSES.md`。
