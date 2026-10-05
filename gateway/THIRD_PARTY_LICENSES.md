# Third-Party Licenses & Attributions

本项目以 MIT 许可开源。以下列出直接依赖、引用的开源组件及其许可证，以及代码借鉴来源。

## npm 运行时依赖

| 包 | 版本 | 许可证 | 用途 |
|---|---|---|---|
| @modelcontextprotocol/sdk | 1.x | MIT | MCP server 框架 |
| playwright | 1.x | Apache-2.0 | 浏览器自动化（fetch 路由③ + browser_* 工具） |
| turndown | 7.x | MIT | HTML → Markdown 转换 |
| @mixmark-io/domino | 2.x | BSD-2-Clause | Node DOM 解析（turndown 用） |
| yaml | 2.x | ISC | gateway.yaml 解析 |
| zod | 4.x | MIT | 配置/工具 schema 校验 |

## npm 开发依赖（测试工具链，不进生产、不分发）

| 包 | 许可证 | 说明 |
|---|---|---|
| vitest / vite / typescript / tsx | MIT / Apache-2.0 等 | 测试与构建 |
| lightningcss（vitest→vite 传递） | MPL-2.0 | **弱 copyleft（文件级）**。仅测试时使用，未修改其文件，不分发 |

> MPL-2.0 说明：仅当你修改 lightningcss 自身源码文件时才受其约束。本仓库仅作为测试工具链传递依赖使用，未修改，无传染影响。

## 引用的外部服务（独立进程，通过 HTTP API 交互，不并入本仓库代码）

| 服务 | 许可证 | 用途 |
|---|---|---|
| [searxng](https://github.com/searxng/searxng) | AGPL-3.0 | 元搜索后端。以独立进程运行，本仓库通过 `/search?format=json` 调用，不包含/修改其源码 |
| [FlareSolverr](https://github.com/FlareSolverr/FlareSolverr) | MIT | Cloudflare 挑战求解。独立进程，通过 `/v1` 调用 |

> AGPL-3.0 说明：AGPL 约束的是"基于其源码的修改/衍生作品"。searxng 以独立服务运行、通过 HTTP API 交互（类似调用数据库/外部搜索 API），不构成衍生作品。本仓库未修改其源码。

## 引用的数据与代码借鉴

| 来源 | 许可证 | 说明 |
|---|---|---|
| [StevenBlack/hosts](https://github.com/StevenBlack/hosts) | MIT | 广告过滤域名列表。数据文件 `data/adblock/hosts` 由 `scripts/update-adlist.sh` 拉取，或网关启动时自动拉取（若缺失/过期） |
| [ihor-sokoliuk/mcp-searxng](https://github.com/ihor-sokoliuk/mcp-searxng) | MIT | 借鉴其 `search.ts` 的 searxng 结果清洗思路（归一化/切片）。实现为独立代码，函数命名与结构均不同 |
| [microsoft/playwright-mcp](https://github.com/microsoft/playwright-mcp) | Apache-2.0 | 参考其"无障碍树快照"交互模式设计 browser_* 工具 |

## 本仓库自研代码

`src/` 下所有 TypeScript 代码为原创（借鉴思路的独立实现，无直接拷贝）。未引入任何 copyleft 组件到生产代码。

---

*生成日期：2026-08-05。如有引用变动请更新此文件。*
