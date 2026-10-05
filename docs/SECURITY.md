# 安全说明

## 1. 密钥策略

- 本仓库**不含任何密钥**。所有凭据通过环境变量注入：
  `TAVILY_API_KEY`、`BRAVE_SEARCH_API_KEY`、`EXA_API_KEY`、`PARALLEL_API_KEY`、
  `FIRECRAWL_API_KEY`、`KEENABLE_API_KEY`、`GATEWAY_TOKEN`。
- 实例配置文件（`.env`、`gateway.yaml`）已被 `.gitignore` 屏蔽；
  入库的只有 `*.example` 模板，其中所有密钥字段均为占位符。
- 发布前的自动化检查（本仓库的历史提交经过同一套检查）：
  ```
  grep -rnE 'tvly-[A-Za-z0-9]{10,}|sk-[A-Za-z0-9]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY' .
  ```
- SearXNG 的 `secret_key` 请自行生成：`openssl rand -hex 32`。

## 2. 结果污染防控（检索类项目必读）

搜索/抓取的原始结果若混入成人站点域名，会随工具输出**原样进入对话上下文**；
此后每一轮请求都携带该字符串，上游内容审核会持续返回 `finish_reason=content_filter`，
表现为「模型拒绝回答」——**整个会话被毒化，连中性提问也会被拦**（已在真实环境复现）。

本项目采取三道防线：

1. **源头**：SearXNG 开 `safe_search: 2`（严格安全搜索）。
2. **域名黑名单**：SearXNG 的 `hostnames` 插件 + `hostnames-remove.yml` 移除清单，
   由每日定时任务重建（见 `searxng/systemd/searxng-hostnames-refresh.*`）。
   **清单文件本身不入库**——它是一份大规模成人域名列表，公开分发既无必要也不合适。
3. **使用侧纪律**：终端输出在打印前打码含域名片段；含域名的清单类文件只看规模、不读内容。

## 3. 部署建议

- SearXNG / FlareSolverr / 网关**只监听回环地址**（`127.0.0.1`），不直接暴露公网；
  需要远程访问时经由隧道或反向代理 + 鉴权。
- 网关的 HTTP transport 建议启用 `GATEWAY_TOKEN`，并避免把 `:3000` 直接暴露在公网。
- 抓取模块内置 SSRF 防护（`gateway/src/fetch/ssrf.ts`）：拒绝内网/元数据地址，
  生产环境不要关闭。
- 抓取仅用于公开可访问的页面；请遵守目标站点的 robots 与使用条款。

## 4. 依赖许可

网关的运行期依赖均为宽松许可（MIT / Apache-2.0 / BSD-2-Clause / ISC），
逐项清单见 `gateway/THIRD_PARTY_LICENSES.md`。
