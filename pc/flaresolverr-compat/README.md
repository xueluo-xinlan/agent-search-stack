# FlareSolverr 兼容层（PC 侧住宅 IP 抓取通道）

一套跑在 **Windows 家用机**上的抓取通道：对外暴露 **FlareSolverr 兼容 API**（默认 `http://127.0.0.1:8191`），
内部用 **真实浏览器（Playwright + Chromium/Edge）** 渲染页面。

存在的理由：数据中心 IP 抓国内电商/社区站（淘宝、京东、苏宁、小红书、B站）经常直接吃风控，
而**家用宽带 IP + 真实浏览器指纹**能过掉大部分 Cloudflare 交互挑战与基础风控。
上层网关（见仓库 `gateway/`）把它当作 `direct → FlareSolverr → playwright` 三级路由里的第二级。

> ⚠️ **实验性代码，且只在作者的一台机器上实测过**。这批脚本是在实际抓取任务中长出来的，风格不统一、部分带一次性任务的痕迹；
> 运行环境是 Windows 11 + Python 3.11 + 系统 Edge，**换个环境不保证能用**——绝对路径与 `pythonw.exe` 位置都要按自己的机器改，
> 站点风控表现也会因 IP 与时段不同。能用、注释齐全，但不要期待它是一个打磨过的、跨环境验证过的开源项目。

---

## 文件说明

### 核心

| 文件 | 作用 |
|---|---|
| `pc_flaresolverr_compat.py` | **兼容层本体**（`1.2.1-compat`）。HTTP 服务 + Playwright 持久化上下文 + 同站限速 + 登录墙/风控页识别 |
| `pc_fs_hnew.py` | 同源变体（针对 `--headless=new` 的启动差异） |
| `pc_test_flaresolverr.py` | 端到端自测：拿一个被 Cloudflare 保护的站验证真能过墙 |
| `verify_cookies.py` / `verify_cookies.bat` | **人工过验证入口**：拉起有头浏览器，手动过验证码/登录，cookie 落盘进 profile |
| `pc_guided_login.py` + `restart_guided_login.bat` | **商城引导登录**：打开淘宝 / 京东首页由人工登录，窗口保持约 25 分钟；cookie 落到独立 Edge profile。比 `verify_cookies` 更适合"只登录、不验证"的场合 |
| `verify_check.py` | 登录态验证：抓两个"最能说明问题"的页面（京东价格占位符 vs 真实数字） |

### 常驻与运维

| 文件 | 作用 |
|---|---|
| `start_flaresolverr_compat.bat` | **幂等自愈启动器**（纯 ASCII，cmd 按 CP936 读）。健康 → 直接退出；不健康 → 先清残留再起新实例 |
| `pc_install_flaresolverr_task.ps1` | 注册计划任务 `FlareSolverrCompat`（登录时 + 每 5 分钟自愈），并现场拉起、等待预热、打印 `/health` |
| `pc_e2e_check.ps1` | 端到端检查：过兼容层打一个 Cloudflare 挑战测试站 |
| `pc_diag_pythonw.ps1` | `pythonw.exe` 启动方式诊断 |
| `fix_bat.ps1` | 从启动器里剔除硬编码的 `--headless`（改有头模式时用） |
| `mk_shortcut.ps1` | 生成桌面快捷方式 + 家目录转发的 bat（转发 bat 按 GBK 写，cmd 才读得对） |

### 采集器（都走 `127.0.0.1:8191`）

| 平台 | 文件 |
|---|---|
| 多站通用 | `shop_search.py`（多站商品搜索 → 结构化结果） |
| 淘宝 | `taobao_search.py`、`shop_multi.py` / `shop_multi2.py` / `shop_multi3.py`、`tb_detail.py`、`tb_detail_sku.py`、`tb_scan.py` / `tb_scan2.py` / `tb_scan3.py` |
| 京东 | `jd_links.py`（品类聚合页 → `item.jd.com` 链接） |
| 苏宁 | `suning_search.py`、`suning2.py` |
| 小红书 | `xhs_probe.py`、`xhs_probe2.py` |
| B 站 | `bili_search.py`、`bili_search2.py`（关键词搜索）、`bili_comments.py`（简介+热评）、`bili_deep.py`（详情+评论） |

---

## 安装

```powershell
# 1) 依赖（Python 3.11 建议）
pip install playwright
playwright install chromium        # 或复用系统已装的 Edge

# 2) 把脚本放到一个固定目录，例如 C:\Users\you\flaresolverr_compat\
#    ⚠️ 必须改路径：本目录的 .bat / .ps1 里写的是占位路径 C:\Users\you\...
#       （仓库为脱敏统一替换过），要改成你自己的实际路径与 pythonw.exe 位置

# 3) 注册常驻计划任务（需管理员 PowerShell）
powershell -ExecutionPolicy Bypass -File .\pc_install_flaresolverr_task.ps1
#    → 最后应打印 health 内容，且 browserReady 为 true

# 4) 首次人工过验证（有些墙只能靠账号态翻过）
.\verify_cookies.bat
#    → 弹出有头浏览器，手动过验证码 / 登录；cookie 落盘到 browser_profile\

#    淘宝 / 京东这类"必须账号态"的，先单独刷一次登录（窗口保持约 25 分钟，够手动登录）：
.\restart_guided_login.bat        # 等价于 python pc_guided_login.py
#    → 登录后 cookie 落到 edge_profile\，之后再用 .\verify_cookies.bat 验证是否生效
```

手动前台跑（排障用）：

```bash
python pc_flaresolverr_compat.py --port 8191 --warmup \
  --min-host-gap 1.2 --min-global-gap 0.35 --jitter 0.8
```

## 存活判据（踩过的坑，务必照做）

**端口活着 ≠ 服务活着。** Playwright 实例中毒后（例如一次 `net::ERR_CONNECTION_CLOSED` 的导航失败），
HTTP 端口仍然应答，但之后每个请求都会抛
`It looks like you are using Playwright Sync API inside the asyncio loop`。

唯一可信判据是 `/health` 的 **`browserReady == true`**。本目录的启动器、安装脚本都按这条实现
（先探 `/health` → 不健康就先杀残留再起重）。

`/health` 还返回：profile 目录与 cookie 计数（确认持久化是否生效）、`byHost` 按域统计。

## 行为说明

- **持久化 profile**：`--profile-dir`（默认脚本同目录 `browser_profile/`）。cookie/localStorage 落盘，重启继续复用——
  这是"人工过一次验证就能长期免验证"的前提。
- **同站限速**：`--min-host-gap`（同 host 最小间隔）、`--min-global-gap`、`--jitter`。只消除自己制造的突发尖峰，
  不改变"通道被判定为自动化"这一根因。
- **登录墙 / 风控页**：命中 `BLOCKED_DOMAINS`（如 `login.taobao.com`、`plogin.m.jd.com`）时不打开浏览器、
  不提取内容，以 `status:"ok"` 返回，并在正文里带机器可读信号 `[BLOCKED kind=… reason=…]`，
  `solution` 里给 `blocked` / `blockedKind`（`login-wall` 或 `risk-control`）。
  之所以用"返回说明"而不是报错，是因为上层网关在失败时会转 playwright 兜底，报错等于多抓一次。
- **正文型登录墙嗅探**：返回 200、不跳转、正文却写着"请登录"的站，只挂 `suspectedWall` 标记，不拦截。

## 合规与边界

> 仅用于**个人研究**目的，请遵守目标站点的 `robots.txt` 与服务条款；不要用于高频、大规模或商业采集。
> 抓到的数据里若含个人隐私，请自行脱敏并遵守当地法律。本项目不提供任何绕过付费墙或账号权限的能力。

同时注意：本目录的采集器默认连 `http://127.0.0.1:8191`——**没起兼容层它们跑不通**，
这不是 bug，而是设计（抓取通道与解析逻辑解耦）。
