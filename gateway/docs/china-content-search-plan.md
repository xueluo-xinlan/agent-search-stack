# China-Search MCP 方案（中国内容平台搜索接入）

> 状态：部分实施（2026-08-06 立项；**B站 searxng cookie 已配**，知乎/抖音/小红书未做）
> 关联 todo：china-search-1..8

## 背景

通用搜索（searxng 聚合）对中国社区内容覆盖差：
- brave 被限流、startpage CAPTCHA、doubao 缺 key（无 WEB_SEARCH_API_KEY 环境变量）
- `use_default_settings: true` 继承了 searxng 内置 `google cse` 引擎（内置 settings.yml 第 1236 行，默认未禁用），主力引擎全挂时它兜底返回垃圾结果（全是无关 PDF）
- 实测 2026-08-06：搜「蓝色大肥鱼」→ unresponsive_engines=[brave, startpage]，20 条结果 100% 来自 google cse

**已修**：
- 评论接口 bug（bilibili-social `bilibili_get_comments` count 字段 int/dict 兼容，`~/bilibili-mcp/bilibili_social_mcp.py`），需重启 gateway 生效。
- **B站 searxng cookie**（2026-08-06）：`~/crw/config/searxng/settings.yml`（真实挂载源，非 /tmp 路径）给 `bilibili` engine 注入 Hermesite 的 SESSDATA/bili_jct。实测搜「翻页时钟」50 条结果中 bilibili 来源 20 条（cookie 生效）。⚠️ settings.yml 含明文 cookie，已 `git rm --cached` + `.gitignore`，模板见 `config/searxng/settings.yml.example`。

**待修**：searxng settings.yml 禁用 google cse（`~/crw/config/searxng/settings.yml` 是容器挂载源，docker 容器 searxng-main）。

## 目标

把 B站 / 抖音 / 知乎 / 小红书 的搜索能力做成 MCP 工具，解决通用搜索引擎对中文社区内容覆盖差的问题。

## 平台可达性实测（2026-08-06，裸 HTTP 探测）

| 平台 | 结果 | 技术路线 |
|---|---|---|
| B站 | ✅ 已有凭证（Hermesite）+ bilibili_api SDK | API 直连（wbi/search/type + WBI 签名，技能 bilibili-api-raw 有完整参考） |
| 知乎 | 403（x-zse-96 签名，zh-zse-ck cookie 为签名盐） | Playwright 渲染搜索页（签名 JS 逆向成本高，不值） |
| 抖音 | 200 但内容空壳（JS 渲染） | Playwright 渲染 |
| 小红书 | 301（搜索强制登录） | Playwright + 登录态（web 反爬最严） |

## 架构

独立 MCP 服务器，参考 `~/eleme-mcp/` 模式（playwright-mcp 技能）：

```
~/china-search-mcp/
├── server.py          # MCP 入口：search_bilibili / search_zhihu / search_douyin / search_xiaohongshu
├── adapters/          # 每平台一个适配器（B站走 API，其他走 Playwright）
├── auth/              # 登录态持久化（小红书/抖音 cookie）
└── venv/
```

技术要点（来自 playwright-mcp 技能，都是踩过坑的结论）：
- Playwright iPhone 13 视口 + zh-CN + Asia/Shanghai 时区
- `domcontentloaded` 替代 `networkidle`（中国 H5 超时）
- SPA 提取包 `setTimeout(≥800ms)` Promise（渲染时机）
- 登录态用 storage_state 持久化；验证码走 CDP 远程浏览器手动处理（Xvfb + socat，不用 VNC）
- B站搜索：复用 bilibili_api + 已有凭证（未登录态 wbi 搜索会被限流，data.result=None）

## 工具设计

- `search_video(platform, keyword, limit)` 统一入口 → 返回标题/作者/链接/热度
- 或每平台一个专用工具（B站 search_bilibili 最快落地，可直接扩展现有 bilibili-social MCP）

## 决策点（待用户确认）

1. **分期**：一期 B站+知乎（无需登录，立即可用）→ 二期 抖音+小红书（需登录）
2. **登录**：抖音/小红书 web 搜索强制登录，需用户配合一次（CDP 手动登录 or 导 cookie）
3. **资源**：3.8G RAM 已跑 searxng/flaresolverr/couchdb/gateway 浏览器池，再加 Playwright 实例约 +400MB
4. **入口**：独立 MCP vs 扩展 agent_search_gateway（独立 MCP 开发成本低、可独立演进；扩展 gateway 省内存但 Node 里写适配器复杂）

## 相关仓库/路径

- 搜索网关：`~/agent_search_gateway`（djasdh/agent_search_gateway）
- searxng 配置：`~/crw/config/searxng/settings.yml`（含明文 cookie，勿提交）（容器 searxng-main 挂载源）
- B站 MCP：`~/bilibili-mcp/bilibili_social_mcp.py`（已有 Hermesite 凭证）
- 参考实现：`~/eleme-mcp/`（Playwright MCP 完整模式）
- 技能：playwright-mcp、bilibili-api-raw
