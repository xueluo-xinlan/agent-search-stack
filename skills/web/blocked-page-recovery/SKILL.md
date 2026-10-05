---
name: blocked-page-recovery
description: "Use when a fetch fails: 403/429, paywall, WAF, bot wall."
version: 1.2.0
author: Hermes Agent
license: MIT
platforms: [linux, macos, windows]
metadata:
  hermes:
    tags: [Research, Archives, Wayback, Paywall, WAF, Fallback]
    related_skills: [grounded-citations]
---

# Blocked-Page Recovery

When a page won't fetch — 403/429, Cloudflare "Just a moment...", a paywall,
or a bot-detection interstitial — don't give up and don't loop on the same
URL. Third-party services often hold a **copy** of the page. Work down this
ladder, cheapest first.

## The ladder

```
1. Wayback Machine  — archive.org "available" API  (snapshot + timestamp)
2. archive.today    — domain rotation: archive.ph → .md → .li → .is
3. Jina Reader      — only if JINA_API_KEY is set  (live server-side render)
4. API-first pivot  — look for /api/, /graphql, .json, or RSS on the same host
5. Real browser     — browser tool as the last, most expensive resort
```

Run it in one shot with the bundled script:

```bash
python3 scripts/recover_page.py "https://example.com/blocked-article" --json
```

The script tries each route in order, validates every body (see "Fake
successes" below), and prints the first genuine hit with its provenance.

## Provenance discipline (non-negotiable)

Every recovered copy carries a provenance you MUST preserve when citing:

| Route | Provenance | How to cite |
|-------|-----------|-------------|
| Wayback / archive.today | `snapshot` | Cite WITH the snapshot date: "as archived 2026-08-06". Never present a snapshot as the live page — it may be stale. |
| Jina Reader | `live` | Server-side re-render of the live page; cite normally. |
| Live fetch / browser | `live` | Cite normally. |

If the user needs *current* data (prices, availability, breaking news), a
snapshot is context, not an answer — say so explicitly and note its age.

## Manual routes

### 1. Wayback Machine (best provenance, try first)

```bash
# Discovery: returns closest snapshot URL + timestamp as JSON
curl -sL "https://archive.org/wayback/available?url={URL}"
# Then fetch archived_snapshots.closest.url
```

For enumerating many snapshots (or recovering deleted pages), the CDX index:

```bash
curl -sL "https://web.archive.org/cdx/search/cdx?url={URL}&output=json&limit=10"
```

CDX intermittently returns 503 under load — if it does, fall back to the
`available` API; don't retry-hammer it.

Works for: any publicly crawled URL. Fails for: robots-blocked sites,
never-crawled URLs, JS-only SPAs (snapshots don't render).

### 2. archive.today (paywalls, deleted content)

User-submitted archives — often has paywalled news articles Wayback lacks.
Rate-limits aggressively (429) and rotates domains, so iterate:

```bash
for d in archive.ph archive.md archive.li archive.is; do
  curl -sL --max-time 20 "https://$d/newest/{URL}" -o ~/.hermes/cache/scratch/page.html \
    -w "%{http_code}" && break
done
```

**Validate the body, not the status code** — a 429 still ships several KB of
rate-limit HTML that looks like a success to a size check alone.

### 3. Jina Reader (requires JINA_API_KEY)

`r.jina.ai` re-renders the live page in a real browser server-side and
returns markdown. Anonymous access is dead (401 → Turnstile); a key is
required:

```bash
curl -s -H "Authorization: Bearer $JINA_API_KEY" "https://r.jina.ai/{URL}"
```

Handles JS SPAs that archives can't. Skip this route entirely when the env
var is unset.

### 4. API-first pivot

WAFs protect the HTML surface far more aggressively than the data endpoints
behind it. After 2-3 blocked attempts on a site, stop fighting the HTML and
look for:

- `/api/...`, `/graphql`, or `.json` variants of the page URL
- An RSS/Atom feed (`/feed`, `/rss`, `<link rel="alternate">` in any copy
  you did recover)
- A sitemap (`/sitemap.xml`) revealing canonical URLs that may not be gated

## Fake successes — routes that LIE

These return HTTP 200 with a plausible body that is NOT the page. The script
rejects them automatically; reject them manually too:

- **Google Cache is dead** (since mid-2024). `webcache.googleusercontent.com`
  returns 200 + tens of KB, but it's a Google Search interstitial with a JS
  redirect, not a cache. Never use it.
- **AMP caches** (`*.cdn.ampproject.org`) mostly return a ~300-byte
  `<title>Redirecting</title>` meta-refresh stub pointing back at the
  original (blocked) URL. Treating that as success creates a fetch loop.
- **Rate-limit bodies**: archive.today 429 pages are multi-KB HTML. Check for
  the target's actual content (title words, expected strings), not just size.

Detection heuristics the script applies: body under a per-route byte floor;
meta-refresh/JS-redirect stubs whose target is the original host; interstitial
titles ("Just a moment", "Redirecting", "Google Search", "Attention Required").

## Proxy relays: don't

Generic "web proxy" relays are man-in-the-middle by construction. Never send
cookies or Authorization headers through one, and don't use them for anything
the user will rely on — provenance is unverifiable. Prefer archives, which at
least timestamp their copies.

## 四道墙：为什么"游客可阅览"的站依然抓不到

浏览器地址栏里的"游客"不是无痕访客——他带着完整 JS 运行时、真实指纹、
住宅 IP 和 Cookie 历史。抓取通道少给一样，服务端就把请求归进另一个桶。

按**落点证据**判定是哪道墙，不要按站点名气猜，更不要按 HTTP 状态码猜：

| 墙 | 落点证据（实测样本） | 补什么才有用 |
|---|---|---|
| 登录墙 | `item.taobao.com/item.htm?id=...` → `login.taobao.com/havanaone/login.htm?..._____tmd_____...`；小红书 → `/login?redirectPath=` | 登录态 cookie（持久化 profile + 人工登录一次） |
| 风控墙 | `item.jd.com/44807734636.html` → `pc-frequent-pro.pf.jd.com/?from=pc_item&reason=403` | 换出口 IP、降频；cookie 未必有用 |
| JS 渲染墙 | 200 + 大体积 HTML 但正文是空壳（拼多多首页 179KB 无内容） | 真浏览器渲染 |
| 无墙（伪阳性） | 知乎问题页 403，但正文 49604 字符完整 | 什么都不用补——它本来就能读 |

判定纪律（违反即等于虚构结论）：

1. **落点 URL 才是判据，域名不是。** `pc-frequent-pro` 域名里带 "frequent"，
   但同行参数 `reason=403` 说明本次是权限拒绝而非频率超限。把域名当原因，
   会得出"降频就能解"的错误结论。
2. **状态码不是判据。** 知乎实测 403 + 完整正文。按状态码判"不可用"会误杀。
3. **服务端自己泄露的标记最值钱。** 淘宝跳转 URL 里的 `_____tmd_____` 是阿里
   反爬的判定标记——服务端主动告知"已把你归为非正常流量"。
4. **替身只能证伪。** 抓到的是登录页落点，就别说"该站全站不可抓"。

## API 层不是万能解：先逐字段实测再承诺

"绕开 HTML 走 API"对**部分**字段有效，对另一些完全无效。别按"有开放平台"
的名头推断，要按字段实测。京东实测（2026-10）：

| 通道 | 结果 |
|---|---|
| `item.m.jd.com/product/{sku}.html` | 200 / 276KB，含真实商品名、品牌、`venderId`、促销文案；不过登录页、不过风控页 |
| 同页价格字段 | `"priceLoginText":"登录查看价格"`、`"urgeLogin":true`，价格值为占位 `"4??"` —— 价格本身是登录墙 |
| `p.3.cn/prices/mgets` | 连接超时，已不可用 |
| `cd.jd.com/promotion/v2` | DNS 解析失败，域名已不存在 |

即：**商品元数据可免登录取，价格不可。** 把老接口凭记忆当成"还能用"会白烧
一轮调试——每次都实测，失败要留下 `000` / `timeout` / `DNS` 这类原始依据。

**先试移动版域名，再谈 API。** 同一站点常常是"PC 版是墙、移动版是门"：
京东 `item.jd.com` 未登录只得 39KB 通用壳（浏览器走该 URL 更会被踢到风控页），
而 `item.m.jd.com/product/{sku}.html` 直出 276KB 完整商品页，**且对机房 IP
同样开放**——用 `curl` 单条命令即可，不必动用浏览器。先花 10 秒换移动版域名，
往往比找 API 更快。反向案例：淘宝没有这种后门，`detail.m.tmall.com` 照样
302 到 `login.m.taobao.com`——它的墙认 cookie，不认域名。

**判定关键词用英文标识符。** 登录跳转写作 `login.m.taobao.com`、`passport.*`、
`/signin`，正文里未必出现"登录"二字——按中文文案 grep 会漏判。

现成脚本：`python3 ~/jd_h5.py {sku} [--json]`（京东 H5 商品元数据；支持多个
sku 或任意京东 URL、`--file skus.txt`、`--out result.json`；含从页面实测挖出的
促销字段名 `discountText` / `couponDiscount` / `presaleCouponPriceText` 等。
价格项会诚实地标注为不可得，不要把它当失败）。技能内自带副本：
`scripts/jd_h5.py`（与 `~/jd_h5.py` 同步），换机器时直接用它。

## 抓取层"跳过登录页"的设计约束

让浏览器后端停止抓取登录页 / 风控页本身，可以省下配额、也不再加深"这是
机器人"的印象。但实现有三条硬约束：

1. **不能用"返回错误"实现跳过。** 网关在 FlareSolverr 失败后会转入 playwright
   兜底，报错等于**再抓一次**，比不跳过更糟。必须以 `status:"ok"` 返回。
2. **返回一段一眼可识别的说明**，而不是登录页内容。写法：正文里放
   `[BLOCKED kind=<login-wall|risk-control> reason=<host:...|path:...>]`，同时在
   JSON `solution` 里给出 `blocked` / `blockedKind` 两个机器可读字段。
3. **拦截日志要与真实成功可区分**：用 `ok(blocked)`，不要沿用 `ok`；且只打
   原始请求 URL，别把登录跳转 URL 灌进日志（淘宝 `redirectURL` 实测 1400+ 字符）。

两类 kind 的可救性不同，不可混为一谈：`login-wall`（补登录态 cookie 可能解开）
与 `risk-control`（风控判定，补 cookie 也可能无效）。

## 账号态的墙：技术上不可绕（京东价格实测）

价格、库存这类字段常常是**账号墙**——不是 UA 墙，也不是域名墙。
四种身份抓 `item.m.jd.com/product/{sku}.html`（桌面 Edge / Googlebot /
Baiduspider / iPhone Safari）**一律 241866 字节、一律 `"priceLoginText":"登录
查看价格"`、价格一律占位 `"4??"`**。换 UA、冒充搜索引擎爬虫、伪装移动端，全部无效。

判定顺序：先在页面里找账号态标记（`priceLoginText` / `urgeLogin` /
`login.aspx?tourl=`），命中就直接报告"该字段需要账号"，**不要再去试指纹与 UA**——
那不是这道墙的开关。

第三方比价站同样得逐站实测，别按名气推断：

| 站 / 入口 | 实测结果 |
|---|---|
| `s.manmanbuy.com/pc/search/result?keyword={sku}` | 200，标题回显 sku；但结果区无价格 |
| `tool.manmanbuy.com/HistoryLowest.aspx`（历史价格工具） | **200 且不跳转、正文含"请登录"、页内 `home.manmanbuy.com/login.aspx?tourl=` → 账号墙** |
| `www.smzdm.com` | 200 / 1,217,654 字节，真内容 |
| `search.smzdm.com/?s={词}` | 裸 curl **202 / 209 字节**（挑战页）；经真浏览器渲染后 200 / 324,054 字节、搜索词命中 318 次 |

结论：值得买搜索页的挑战**能被真浏览器解掉**，可作优惠信息通道；但"指定 sku 的
实时价"在京东与慢慢买都落在账号墙后面——如实报告，不要承诺能抓。

## 页面内嵌结构化数据：四类并行，别只认"知名变量"

网关只取 `solution.response`（经 htmlToMarkdown），页面里的结构化字段在转换中
全被丢弃。要在抓取层交付结构化字段，得在返回 HTML 末尾附加一个 `<pre>` 块。

**只抓 `__NEXT_DATA__` 这类知名变量会全落空。** 京东 H5 页实测：
`application/ld+json` 数量 **0**、`og:*` meta **0**、`__NEXT_DATA__` / `__NUXT__` /
`__INITIAL_STATE__` / `__APOLLO_STATE__` / `__PRELOADED_STATE__` **一个都不存在**。

四类并行才覆盖得住：

| 信号 | 命中场景 |
|---|---|
| `<meta property/name>`（og:*、description、product:price:*） | 新闻、博客、多数电商 |
| `<script type="application/ld+json">` | 商品、食谱等结构化数据站 |
| 知名 SSR 变量（`__NEXT_DATA__` / `__NUXT__` / `__INITIAL_STATE__` …） | Next.js / Nuxt 类 SPA |
| **通用键名嗅探**（`"skuName"` / `"venderId"` / `"price"` / `"skuId"` …） | 字段散落在 JS 片段里的站（如京东） |

京东实测**只有第四类命中**：`skuId=44807734636`、`venderId=755338`、
`shopName=德玛仕消毒柜旗舰店`、`price=4??`（占位符，正是账号墙留下的痕迹）。

## 抓取通道跨机调试的两个坑

1. **scp 单文件上限 200KB（实测 204800 字节）。** 531,798 字节的响应回传后只剩
   204800，`json.load` 报 `Unterminated string starting at char 144`——那是**旧文件
   的残留**造成的，不是真的截断到 144 字节，很容易误诊。**大响应一律在目标机
   就地解析，只回传结论**（本项目用 `_probe2.py` / `_links.py`）。
2. **`curl -L` 会毁掉 POST。** 服务端对 `/v1` 返 302 后，curl 跟随重定向会把 POST
   降级为 GET（RFC 7231 对 302 的规定），服务端于是回一个短错误体。改用 Python
   urllib 调用绕开。
3. **`py_compile` 查不出未定义变量。** 曾出现 `_bump(host, ...)` 用了未定义的
   `host`：本地与目标机双重 `py_compile` 全绿，一真跑就 `name 'host' is not
defined`。**编译通过 ≠ 能跑，改完必须真实发起一次请求。**

## 抓取层浏览器档位：`--headless=new` 与有头等价（实测）

选档只看"要不要窗口"，**不该拿成功率赌**。兼容层三档：

| 档位 | 启动方式 | 窗口 | 实测 |
|---|---|---|---|
| 有头（默认） | `HEADLESS=False` + `--window-position=-32000,-32000` | **会出现**（任务栏图标；自愈重启时闪现） | 基线 |
| 旧式无头 | `headless=True` | 无 | 指纹特征明显（源码注释原话） |
| **`--headless=new`** | `headless=False` **+ args 加 `--headless=new`** | **无** | **与有头逐条一致** |

实测（同一份 profile 拷贝，两边 `profile cookie count at launch` 均为 404，只变"有头/无头"一个变量）：

| URL | 有头 8191 | headless=new 8192 |
|---|---|---|
| 淘宝搜「手办柜」 | 200 · 商品卡 51 · SKU 50 | 200 · 卡 51 · SKU 50 |
| 淘宝搜「展示柜」 | 200 · 卡 51 · SKU 51 | 200 · 卡 51 · SKU 50 |
| 淘宝详情 ×2 | 200 · SKU 37 / 29 | 200 · SKU 37 / 29 |

耗时多 0.4–0.8s，可忽略。**要无窗口又要能抓，就用 `--headless=new` + 持久化 profile。**

### 三个必踩的坑

1. **对照必须用同一份 profile 拷贝。** 先用空 profile 试 `--headless=new`，淘宝回 385KB 但 `cards=0`——**同时变了"有无登录态"与"有无头"两个变量，结论无效**（空 profile 才是主因）。拷 profile 后两边 cookie count 都是 404，结论才成立。
2. **拷 profile 前必须停掉在跑的实例。** 否则 `robocopy` 返 exit 9 且 `Default\Network\Cookies` = MISSING（文件被锁）。300MB 拷贝约 10–20s，期间该端口不可用：**先 `Disable-ScheduledTask` 再拷、拷完 `Enable`**，否则自愈任务会在拷贝中途把实例拉起来重新锁住。
3. **SSH 会话内 `Start-Process python.exe` 起的进程随会话结束被杀。** 症状：启动日志正常、十几秒后端口"积极拒绝连接"。修正：① 用 `pythonw.exe`；② **把"启动→等 ready→跑测试→关闭"放进同一个 SSH 调用**，不要指望跨调用留实例。

## 兼容层能力清单（v1.2.1）

- `/health` 的 `stats.byHost`：**按域**统计成功/拦截/失败——总计数回答不了"哪些
  站真能抓"。
- `solution.suspectedWall`：正文型登录墙标记（200 且不跳转、正文含"请登录"）。
  **只标记不拦截**——这类误伤面太大，判断权交给消费端（实测命中：慢慢买历史价工具）。
- HTML 末尾 `<pre data-hermes-embedded="1">[EMBEDDED DATA]` 块：meta / JSON-LD /
  知名 SSR / 通用键名字段四类。
- `solution.blocked` / `blockedKind`：跳转型墙，分 `login-wall` / `risk-control`。
- 导航后延时 1200ms ± 400ms 抖动（固定值本身是可识别特征）。
- 失败退避 1.5–3.5s 后完整重建再试一次（立刻重试等于对异常请求再打一次，只会
  加深风控印象）。
