# agent_search_gateway

统一搜索/抓取网关：一个 **MCP server（HTTP transport）**，把搜索、网页抓取、浏览器交互封装成稳定的 agent 工具。

面向 3.8GB 小服务器，全自托管，轻量。已完成 P0–P5 全部阶段。

## 架构

```
Agent（hermes / OpenCode / my-agent-core / 其它 MCP client）
  │  MCP over HTTP
  ▼
gateway (本服务, :3000/mcp)
  ├─ search → searxng (:8888) → 清洗/广告过滤/缓存 → 纯 md
  ├─ fetch  → 智能路由：
  │     ① direct（普通站，HTML→md）
  │     ② FlareSolverr (:8192)（CF 挑战/JS 站渲染）
  │     ③ playwright（复杂 SPA 渲染）
  │     fetch 缓存按渲染方式隔离
  ├─ browser_* → 内嵌 playwright（agent 交互：navigate/click/type/scroll/find/screenshot）
  └─ health → 各后端连通状态
```

组件内存（空闲/工作）：
- searxng ~110MB、FlareSolverr ~85MB、gateway(node) ~180-250MB
- playwright 浏览器：**按需拉起**，空闲 0MB，工作 ~550MB，空闲 360s 或 `browser_close` 自动释放
- 空闲总量 ~450MB；浏览器工作时峰值 ~1GB；3.8GB 预算富余充足

## MCP 工具

| 工具 | 说明 |
|---|---|
| `search` | 搜索网页，返回纯 md（直接回答/纠正/建议/infobox 置顶 + 结果列表）。参数：query/language/time_range/safesearch/categories/engines/min_score/num_results |
| `fetch` | 抓取 URL → md。自动路由 direct/FlareSolverr/playwright。参数：url/max_chars |
| `browser_navigate` | 浏览器打开 URL，返回无障碍树快照（省 token） |
| `browser_snapshot` | 当前页无障碍树快照，可选 target 限定 |
| `browser_take_screenshot` | 截图返回 base64（开关/尺寸可配） |
| `browser_click` / `browser_type` | 点击/输入，返回无障碍树 |
| `browser_scroll` / `browser_find` | 滚动 / 搜索页面文本 |
| `browser_close` | 关闭浏览器释放资源 |
| `health` | 各后端连通状态 |

## 错误码

错误返回 text 以 `[CODE]` 前缀开头（agent 可 grep 判断重试/放弃）：

| 错误码 | 含义 | 建议 |
|---|---|---|
| `SEARCH_TIMEOUT` | searxng 超时 | 可重试 |
| `SEARCH_UPSTREAM` | searxng 不可达 | 稍后重试 |
| `SEARCH_INVALID` | searxng 返回异常 | 放弃 |
| `FETCH_TIMEOUT` | 目标站超时 | 可重试 |
| `FETCH_BLOCKED` | 反爬/SSRF 阻断 | 放弃或换源 |
| `FETCH_NOT_HTML` | 非网页内容 | 放弃 |
| `FETCH_RENDER_FAIL` | 浏览器渲染失败 | 可重试 |
| `FETCH_NETWORK` | 网络错误 | 可重试 |
| `FETCH_INVALID_URL` | 非法 URL | 放弃 |
| `BROWSER_UNAVAILABLE` | 浏览器未启用 | 检查配置 |
| `BROWSER_ERROR` | 浏览器操作失败 | 可重试 |

## 部署

两条互斥路径，终点都是 `http://127.0.0.1:3000/mcp`。完整说明（配置分层、数据卷、升级与排错）见 [`docs/deployment.md`](docs/deployment.md)。

```bash
# A) Docker（推荐）：起 gateway + SearXNG + FlareSolverr，自动生成 token，等 /health 通过
./scripts/docker-up.sh

# B) 裸机（无 Docker，装 systemd 单元，自备 SearXNG/FlareSolverr）
sudo ./scripts/install-native.sh
```

- 容器内配置在 `docker/gateway.docker.yaml`（`host: 0.0.0.0` + compose 服务名寻址），宿主机端口只绑回环，token 由 `.env` 的 `GATEWAY_TOKEN` 注入。
- 只要 `search` / `fetch`、不要 `browser_*` 与 SPA 渲染时：`docker compose build --build-arg INSTALL_BROWSER=0`（镜像小 ~700MB、构建快很多）。

## 快速开始（裸机手动装）

```bash
cd gateway                            # 本仓库内的 gateway/ 目录
npm ci                                # 有 package-lock.json，用 ci 可复现
npx playwright install chromium       # 首次安装浏览器
cp gateway.yaml.example gateway.yaml
./scripts/gateway.sh start           # 启动三件套（searxng/flaresolverr/gateway）
./scripts/gateway.sh status
```

开发模式单独跑网关：

```bash
npm run dev            # tsx 直接跑
npm run build && npm start   # 编译后跑
npm test               # vitest
```

## 接入 MCP 客户端

网关地址：`http://<host>:3000/mcp`

### 无认证

```json
{
  "mcpServers": {
    "search-gateway": {
      "url": "http://127.0.0.1:3000/mcp",
      "type": "http"
    }
  }
}
```

### 带 token（gateway.yaml 的 gateway.token，或 env GATEWAY_TOKEN）

```json
{
  "mcpServers": {
    "search-gateway": {
      "url": "http://127.0.0.1:3000/mcp",
      "type": "http",
      "headers": { "Authorization": "Bearer <你的token>" }
    }
  }
}
```

> 注：不同 MCP 客户端配置字段略有差异（`type`/`headers` 等），按客户端规范调整。

## 配置（gateway.yaml）

完整示例见 `gateway.yaml.example`。关键项：

```yaml
gateway:        # host/port/token
logging:        # level/file
searxng:        # url/timeout_ms
flaresolverr:   # url/enabled/timeout_ms/max_concurrent/trigger_status/fallback_on_empty
search:         # max_results/max_result_chars/cache_ttl_ms/cache_max_entries/max_concurrent
fetch:          # timeout_ms/max_bytes/user_agent/block_private_ips/structural/max_output_chars/cache_ttl_ms/cache_max_entries
ad_filter:      # enabled/level(off|ads|ads+tracking|full)/extra_domains/hosts_file/allowlist
browser:        # enabled/headless/pool_size/idle_ttl_ms/engine(chromium|camoufox预留)/proxy_*/wait_for_selector/screenshot
```

### searxng 配置分工（gateway.yaml vs settings.yml）

搜索系统的 searxng 相关配置分两层，**各读各的，不重复**：

| 文件 | 管什么 | 谁读 | 改后生效 |
|---|---|---|---|
| `gateway.yaml` 的 `searxng`/`search` 块 | **怎么调 searxng**：连哪个地址（`searxng.url`）、超时、结果数、缓存 | gateway (node) | 重启 gateway |
| `/etc/agent-search/settings.yml` | **searxng 内部引擎配置**：启哪些引擎（google/bing/ddg/brave）、safesearch、UA | SearXNG 容器启动时 | `docker restart searxng-main` |

要点：

- `gateway.yaml` 的 `searxng.url` 必须指向 searxng 实际端口（本机 `8890`），flaresolverr 同理（`8191`）
- settings.yml 是独立配置文件，**不要放 `/tmp`**（重启会丢）；本机约定在 `/etc/agent-search/settings.yml`
- searxng 容器挂载方式：`-v /etc/agent-search/settings.yml:/etc/searxng/settings.yml:ro`
- 改引擎开关（如启用/禁用某个引擎）只动 settings.yml + 重启 searxng，**不需要动 gateway**

### 广告过滤（StevenBlack hosts）

- 数据源：StevenBlack/hosts（MIT），本地缓存 `data/adblock/hosts`（gitignore，不入库）
- 力度：`off` / `ads`（默认）/ `ads+tracking` / `full`（对应不同 hosts 文件）
- **天级自动拉取**：启动时若 hosts 缺失/过期（`auto_update_interval_ms`，默认 24h）自动拉取；进程内定时器周期检查，到点拉取并自动刷新广告过滤集（无需重启）
- 手动更新：`./scripts/update-adlist.sh [level]`
- 保白名单 `allowlist` 防误杀（wikipedia/github 等）

## 管理脚本

```bash
./scripts/gateway.sh start|stop|restart|status|logs [searxng|flaresolverr|gateway|all]
./scripts/update-adlist.sh [ads|ads+tracking|full]   # 更新广告过滤列表
./scripts/bench.sh                                    # 本机压测（内存/延迟）
```

依赖组件目录（固定约定）：
- `~/Projects/searxng`（含 searxng.sh）
- `~/Projects/FlareSolverr`（源码 + .venv，需 conda Xvfb 在 PATH）

## 测试与压测

- `npm test`：80 个测试（单元 + 集成 + 真实 playwright 浏览器）
- `scripts/bench.sh`：测量各组件内存/延迟，验证 3.8GB 预算

实测（本机模拟）：
- 空闲内存 ~450MB；搜索后 ~460MB；浏览器工作时 ~1GB；关闭后回落
- 搜索延迟 0.7-3s；fetch 1.9-6.7s（首次）；browser_navigate 13.6s（冷启动）
