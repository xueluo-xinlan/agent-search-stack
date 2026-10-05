# B站 / 贴吧 采集配方（走 PC 住宅 IP）

适用：中文社区口碑调研（HiFi、数码、外设、游戏圈评论与测评）。前置认知见 SKILL.md 的「B站 数据采集」小节 —— 这里只放可复制的形状。

## 0. 为什么绕 PC

`api.bilibili.com` 对 VPS 机房 IP 返回**拦截页 HTML**（不是 4xx，容易被误判成「接口没数据」）。PC 住宅 IP 是当前稳定通道：脚本投到 PC 执行、结果落 PC 端文件再取回。PC 通道与隧道用法见 `windows-remote-ssh-admin` §1。

## 1. 投递 + 执行（base64，避开 cmd 引号地狱）

```bash
# VPS 侧：脚本先本地写好（纯 ASCII 文件名），base64 后经 ssh 落到 PC 的 %TEMP%
B64=$(base64 -w0 ./pc_cmt.py)
ssh -S /run/pc-link.sock -p 2222 -o BatchMode=yes wei@127.0.0.1 \
  "powershell -NoProfile -Command \"[IO.File]::WriteAllBytes('%TEMP%\\pc_cmt.py',[Convert]::FromBase64String('$B64'))\""
# 执行：解释器写绝对路径（SSH 的 PATH 不会带给远端子进程）
ssh -S /run/pc-link.sock -p 2222 -o BatchMode=yes wei@127.0.0.1 \
  "\"%LOCALAPPDATA%\Programs\Python\Python311\python.exe\" %TEMP%\\pc_cmt.py 5 5"
```

分批参数作为脚本入参（起始页 / 每批条数），一批一次调用，**每批自己把结果 append 进同一个 JSON**，中断只丢最后一批。

## 2. 请求形状

```python
import urllib.request
# 关键：简单 UA，且不带任何 cookie
UA = "curl/8.4.0"
req = urllib.request.Request(url, headers={"User-Agent": UA, "Referer": "https://www.bilibili.com"})
```

- `https://api.bilibili.com/x/web-interface/view?bvid=<BV>` —— 拿 `aid`/`cid`/标题/UP/播放量。
- `https://api.bilibili.com/x/web-interface/search/type?search_type=video&keyword=<kw>&page=1` —— 按关键词找测评视频。
- 评论：先由 `view` 取 `aid`，再走 `/x/v2/reply` 系列按 `next` 翻页（视频用 `type=1`）。

**UA 是成败开关**：`curl/8.4.0` 放行；Chrome UA + `buvid3`（即使是从 `/x/frontend/finger/spi` 正规取到的）报 `HTTP Error 412: Precondition Failed`。补 cookie 只会更糟。

## 3. 判据与限速

- **成功 = 响应体是 JSON 且含 `code`/`data`**。返回 HTML 即被拦，按失败处置，别写成「0 结果」。
- 单个 BV 先探通（200 + JSON）再批量。
- 请求间隔 3–4s；一批 4–5 个 URL。SSH 前台单次 ~420s 上限，超时该批全丢。
- 结果写 PC 的 `%TEMP%\*.json`；读取时若报「系统找不到指定的文件」，先怀疑脚本根本没跑起来（解释器路径 / 工作目录），而不是目标站没数据。

## 4. 贴吧：正文取不到时的处置

`/f/search` 与 `/p/<id>` 帖子页在 VPS 与 PC 住宅 IP 两端都被百度安全验证拦下；headless Chrome/Edge、Cookie jar、移动版 UA 都没有改善。

- 改用索引片段：`site:tieba.baidu.com <关键词>`、`~/exa_search.py "<关键词>"`。
- 报告里**显式标注该来源缺口**（「贴吧正文未能直接获取，以下为搜索引擎索引片段」），不把摘要当原文引用。
- 需要一手内容时请用户手动打开页面提供，不要编造帖子内容。

## 5. 推广内容过滤

评论与测评标题先过一遍推广词正则再入库，例：`加V|加微信|私信|优惠券|领券|进群|代购|闲鱼|关注我|链接在|橱窗|快照`。命中即丢弃，不进入结论。经销商带货号、官方账号自评、送测/PR 稿按 SKILL.md 的四档来源分级处理。
