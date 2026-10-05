---
name: chinese-site-access-triage
description: "Use when a Chinese site won't scrape; triage which wall."
version: 1.1.0
author: Hermes Agent
license: MIT
platforms: [linux, macos, windows]
metadata:
  hermes:
    tags: [Research, China, Anti-bot, Triage, Fetch]
    category: research
    related_skills: [chinese-community-gear-research, web-research-playbook, blocked-page-recovery]
---

# 中文站抓不到时的定位手册

## When to Use

- 用户问「为什么这个站抓不到 / 我记得游客明明能看」。
- 购物（淘宝 / 京东 / 拼多多 / 1688 / 苏宁）、视频（B 站）、帖子（贴吧 / 知乎 / 小红书）目标抓取失败。
- 任何 curl / `web_extract` / MCP `fetch` **返回 200 但正文不对**的场合。

上游阶梯（先去哪问、再取正文）见 `web-research-playbook`；器材横评流程见
`chinese-community-gear-research`；已封站的**存档回退**见 `blocked-page-recovery`。
本技能只管一件事：**先判清是哪一种墙，再决定用什么通道**。

## 铁律一：分清「三种墙」，处置完全不同

三种墙从状态码看长得一样，但能不能救、怎么救是两回事：

| 墙 | 判据 | 典型 | 处置 |
|---|---|---|---|
| ① 业务级强制登录 | 302 → `login.*` / `passport.*`，或 200 的「亲，请登录」页 | 淘宝/京东**搜索页**、小红书全站、拼多多、1688 搜索 | **无技术绕法**：要登录态，或换源 |
| ② 反自动化风控 | 200 的首页壳、「百度安全验证」、`*-frequent-pro` 频控页 | 京东商品页、贴吧帖子页 | 真浏览器 + **持久化** profile + 降频 |
| ③ 新会话触发的验证 | 同一 URL 换到**已通过过验证的常驻上下文**就通 | 百度滑动拼图 | 复用持久化 profile，別每个请求开新 context |

用户说「游客能看」通常是对的 —— 但人家能看的是**详情页 / 帖子页**，不是**搜索页**。
把两者混成一句话就会得出错误结论。

## 铁律二：`HTTP 200` 不是成功判据 —— 风控中间页普遍返回 200

- 京东 `item.jd.com/<真实 id>.html`：curl（机房 IP 与住宅 IP 结果一致）返回 **200 + 首页壳**（title = 京东首页标题）；有头 Edge 则被甩到 `pc-frequent-pro.pf.jd.com/?reason=403`「PC 频控页」。两者正文里**都没有商品信息**。
- 百度贴吧 `/p/<id>`：curl 一律 `403` + title「百度安全验证」。
- ⇒ 成功判据 = **目标自己的特征串出现在正文里**（商品标题/SKU/价格、帖子楼层文本），**且体积量级对得上**。`code=200` 只说明「服务器答话了」。

## 铁律三：别先怪出口 IP；IP 通常不是分水岭

同一批 URL，用 VPS 机房 IP 与 PC 住宅 IP 分别 curl，实测**逐条一致**：贴吧都 403、
京东都给首页壳、什么值得买/苏宁都通。IP 只在少数站起作用
（`api.bilibili.com`：机房 412 / 住宅 200）。

⇒ 抓不到时先比**通道**（curl → 无头浏览器 → 有头浏览器 → 持久化 profile）与**频率**，
最后才怀疑出口 IP。「机房 IP 被全封」是一个**已被证伪的外推**，不要再拿它当默认解释。

## 铁律四：探针 URL 必须取自搜索索引，不得凭记忆编造 ID

编造/记忆里的 ID（`?id=6745718…`、`question/1955…`）会返回「商品不存在 / 没有知识存在的
荒原」这类**错误壳页**，**与登录墙长得一模一样** —— 据此下结论，得到的只是关于你那个假 URL
的结论。

- 真实 URL 拿法：`web_search "site:item.jd.com <关键词>"`（同理 `site:tieba.baidu.com`、`site:zhihu.com`）。
- **壳页自检**：多个不同 ID 返回**同样 title + 相近体积** ⇒ 那是降级壳页，不是内容页。

## 铁律五：判定「是否依赖登录」必须用**全新空 profile** 做对照

常驻抓取层的 profile 里**通常带着历史登录态**（淘宝等）。用它测出「游客也能看」是**替身结论** ——
你量的是「已登录的浏览器」，不是「游客」。本技能的铁律一早就写着「淘宝搜索页 = 业务级强制登录」，
若拿带登录态的 profile 去测就会推翻这个正确结论，得出「淘宝搜索未登录可用」的假事实。

- 正确做法：`launch_persistent_context(全新空目录, …)` 抓同一个 URL、**同一个关键词**，
  与常驻 profile 逐项对照（字节数 / 货币符号数 / 商品 ID 数 / 价格 DOM 块数 / 是否落 login 页）。
- 2026-10 实测（关键词「手办」，同一台 PC，唯一变量 = 有无登录态）：

| 站 | 带登录态的常驻 profile | 全新空 profile | 结论 |
|---|---|---|---|
| 淘宝搜索页 | 702 KB / 47 商品 / 48 个 ¥ | 372 KB / **0 商品 / 0 个 ¥** | **依赖淘宝登录态** |
| 天猫搜索页 | 708 KB / 47 商品 | 382 KB / 0 / 0 | 依赖（同一登录态） |
| 1688 搜索页 | 738 KB / 有价 | 跳 `login.taobao.com` | 依赖（淘宝账号通用） |
| 苏宁搜索页 | 202 KB / ¥169·¥5000 | 197 KB / **0 个 ¥** | 依赖（登录态与浏览器模式两变量未完全隔离，别把话说满） |
| **当当搜索页** | 230 KB / ¥14.00·¥108.92 | **230 KB / 119 个 ¥** | ✅ **不需要登录** |
| **什么值得买** | 356 KB / 76.00元·346.41元 | **367 KB / 8 个「元」价** | ✅ **不需要登录**（价格是「元」格式，只数 ¥ 会漏判） |
| 闲鱼搜索页 | 308 KB 但 0 价格 | 12.6 KB | ❌ 数据 JS 后加载，抓不到正文 |
| 京东 / 拼多多 / 唯品会 | 跳登录 | 跳登录 | 各自登录墙（拼多多网页版无登录入口） |

- **空 profile 里也会有 `cookie2` / `_tb_token_` / `cna` 等 cookie** —— 它们是**匿名访客 cookie**，
  **不能**当作「已登录」的证据。判据只能是**行为**（能否看到商品/价格），不是 cookie 名单。
- 什么值得买是**比价站**，专门聚合各平台价格 —— 拿不到某站价格时值得先来这里试。

## 铁律六：Edge/Chrome 127+ 的 App-Bound 加密 —— 复制 profile 搬登录态已不可行

- 现象：把用户日常 Edge 的 `Local State` + `Default\Network\Cookies`（416 KB / 895 条）**原样复制**
  到抓取层 profile，抓取层的 Edge 打开后 cookie 读到 **0 条**，库被**清回 37 行**。
- 原因：cookie 解密密钥绑定**浏览器应用身份**（App-Bound Encryption），换宿主解不开，Chromium 会**删除**解不开的 cookie。
- ⇒ 「复制日常浏览器 profile 复用登录态」这条老路**已死**。要在自动化里用登录态，只有两条：
  ① **在该 profile 里登录一次**（登录态由它自己产生，密钥自洽）；
  ② `connect_over_cdp()` 接管**正在运行的真实浏览器**（cookie 在其进程内解密）。
- 排查此类问题看两个数：**源库字节数 vs 副本打开后读到的 cookie 条数**，不一致即密钥不匹配。
- 附带坑：`Copy-Item` 遇文件被锁会静默失败（配 `-ErrorAction SilentlyContinue` 时尤其隐蔽），
  结果是抓取层用空目录新建了一个小库，看起来「复制成功」实则毫无内容。**复制后必须比对字节数**。

## 现成的多站购物搜索（直接调用，不必重写解析）

```
~/shop_search.sh <dangdang|smzdm|taobao> "关键词" [--limit N] [--json]
```

- 经 PC 抓取层（`127.0.0.1:8191`，走 SSH 反向隧道）执行，返回结构化条目（标题/价格/原价/折扣/平台）。
- 站点依赖见铁律五的表：**dangdang / smzdm 免登录**；taobao 依赖 profile 内的淘宝登录态。
- 脚本本体：PC 上 `C:\Users\you\flaresolverr_compat\shop_search.py`；VPS 源文件 `~/build/shop_search.py`；
  VPS 入口 `~/shop_search.sh`（淘宝专用 `~/taobao_search.sh`）。
- 新站接入方式：在 `shop_search.py` 的 `SITES` 里加一条 `(url 模板, 解析函数)`，
  解析函数照「按商品 ID 锚点切区间 → 区间内取第一个价格/标题」的套路写。
- **已知瑕疵**：当当个别卡片标题缺失（标题元素落在切片窗口外）；smzdm 的价格写在爆料散文里，
  只覆盖了「到手价 / 降价前售价 / 上次爆料价」三种写法，部分条目价格为 None（平台标注是准的）。

## 拿到 HTML 之后：本地正文提取（不依赖外部服务）

抓取链路的最后一环是「HTML → 干净正文」。把这一环外包给外部提取服务，**它一限流整条链路就断**。
本机装一份离线提取器即可零成本兜底：

```bash
pip install trafilatura lxml_html_clean   # 后者必需：新版 lxml 已把 html_clean 拆成独立包，缺它直接 ImportError
python3 -c "import trafilatura as t; print(t.extract(t.fetch_url('<URL>')))"
```

实测与外部匿名档质量相当（同一篇文章：本地 2,884 字纯正文 vs 外部 3,119 字含标题头部）。

- **`fetch_url` 用的是 trafilatura 自带 UA**，被目标站反爬挡时，改用**已经抓到手的 HTML**
  传给 `extract()` —— 先抓后提，两段解耦，各用各的通道。
- **它不是抓取器**：不执行 JS、无指纹伪装，过不了上面那三种墙。定位就是「把已有 HTML 变成干净正文」。
- 与下面 Pitfalls 第一条呼应：Readability 类提取会被站内侧栏挤占，**换提取器不解决这个问题**，引用前仍要核正文。

## 诊断矩阵：照这个顺序走，每步落一条证据

1. **拿真实 URL**（铁律四）—— 不要用记忆里的 ID。
2. **登岷 curl 对照**（可选但很有价值）：VPS 与 PC 各跑一次同一批 URL，能直接排除 IP 因素。
3. **看 title / 体积 / 关键词**：
   `python3 scripts/probe_pages.py <url>…` —— 只打状态码/体积/title/关键词命中，**永不打印正文**。
4. **真浏览器无头**：MCP `agent_search_gateway` 的 `fetch`（经 PC 侧渲染层）。
5. **有头 / 持久化上下文**：同 URL 再跑一次，对照第 4 步；**差异才是结论**。
6. **把矩阵写进报告**（目标 × 通道 → 拿到了什么），而不是一句「抓不到」。

## PC 侧探针的投递与编码（避坑）

经反向隧道在 PC 上跑 PowerShell 探针时，回传的中文会被 GBK 折腾成乱码。做法：

- 脚本用 **base64 投递**（避免引号被 cmd 吃掉）：`[IO.File]::WriteAllBytes(…,[Convert]::FromBase64String('…'))`，再用
  `powershell -NoProfile -ExecutionPolicy Bypass -File …` 执行。
- 脚本文件保持**纯 ASCII**；判断关键词用 ASCII 串（`login.taobao.com` / `risk_handler` / `captcha`）。
- 要回传中文 title 时：脚本内按 UTF-8 读文件取 title，再 **base64 编码后输出**，VPS 侧解码 —— 全程 ASCII 过线，零乱码。
- curl 加 `--compressed`；不加的话体积对比会被 gzip 误导。

## 不要宣称的东西

- 「用户本人用真浏览器打开就能看」——**未验证就别替用户下结论**。浏览器正在运行时，
  不擅自动其 profile（会锁文件/冲突），直接说未测。
- 「换成有头就好了」——实测无头与有头**都被拦**，真正的变量是**持久化会话里的验证状态**。

## Pitfalls

- **标题对了不等于正文对了**：Readability 类提取可能被站内侧栏（如贴吧的「大家都在逛的吧」）挤占，引用前核正文。
- **一个 0 条 / 一次 403 不能当判据**：同 URL 重试一次，或换通道再量；单次观测只能证伪，不能证真。
- **报告里 200 / 403 / 302 要写清楚是哪种墙**，别一律写成「抓不到」——用户要的是可执行结论。
