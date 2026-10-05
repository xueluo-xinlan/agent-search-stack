# MediaCrawler：中文平台扫码抓取通道

当 B站 API / 贴吧直取走不通，或需要**批量按关键词抓多平台内容**时，走这条路。
本机项目根：`C:\Users\you\Project_MediaCrawler`，7 平台：小红书(xhs)、B站(bili)、百度贴吧(tieba)、知乎(zhihu)、微博(wb)、抖音(dy)、快手(ks)。

## 环境前提（硬约束）

- **uv 必须写绝对路径**：`C:\Users\you\AppData\Local\hermes\bin\uv.exe`。双击 bat 时的 PATH 与 SSH 会话不同，写裸 `uv` 会报「不是内部或外部命令」。回退：`if not exist "%UV%" set "UV=uv"`。
- 更稳的是直接用 venv 解释器 `%PRJ%\.venv\Scripts\python.exe`——比 `uv run` 快，且不吃 PATH。
- 浏览器是 **Playwright 自带 Chromium**：`%LOCALAPPDATA%\ms-playwright\chromium-<rev>\chrome-win64\chrome.exe`。
  配置里 `CUSTOM_BROWSER_PATH=""`、`ENABLE_CDP_MODE=False`、`CDP_CONNECT_EXISTING=False` ⇒ **不会接管用户已开的 Edge/Chrome**；登录态在项目内 `browser_data\`，与 `Edge\User Data` 物理隔离。

## 登录态：先存好，抓取就不用扫码

抓取脚本每次启动都查登录态，没有就弹二维码。要无人值守，**先单独跑一次「只登录」**。

### 目录公式（从 config 读，不要猜）

`config\base_config.py`：

```
SAVE_LOGIN_STATE = True                 # 必须 True，否则不落盘
USER_DATA_DIR    = "%s_user_data_dir"   # %s ← PLATFORM
HEADLESS         = False                # 必须有头，扫码要看得见
```

实际目录 = `browser_data\<PLATFORM>_user_data_dir`。
`<PLATFORM>` 只接受 **`xhs | dy | ks | bili | wb | tieba | zhihu`**（见 `base_config.py` 的 PLATFORM 注释与 `main.py` 的 `CrawlerFactory.CRAWLERS`）。
**写错平台名 = 登录态存进没人读的目录，白登。**

各平台 `core.py` 拼接方式一致：`os.path.join(os.getcwd(), "browser_data", config.USER_DATA_DIR % config.PLATFORM)`。

> 与 SKILL.md「贴吧正文取不到时的处置」呼应：贴吧要稳定读就得复用**已过验证的 profile**，MediaCrawler 的持久化登录态正是这个机制。

### 最小登录脚本（放项目根）

```python
from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    ctx = p.chromium.launch_persistent_context(
        user_data_dir=os.path.join(PRJ, "browser_data", key + "_user_data_dir"),
        headless=False, viewport={"width": 1366, "height": 900},
        args=["--disable-blink-features=AutomationControlled", "--no-first-run",
              "--no-default-browser-check", "--disable-infobars"])
    page = ctx.pages[0] if ctx.pages else ctx.new_page()
    page.goto(url, timeout=60000, wait_until="domcontentloaded")
    page.wait_for_event("close", timeout=0)   # 0 = 不超时；用户关窗口即返回
```

- `page.wait_for_event("close", timeout=0)` 是「等用户关窗口」的正确写法。
- 用 try/except 包住 `wait_for_event` 与 `ctx.close()` —— 用户直接杀掉窗口时 Playwright 会抛 Target closed。
- `goto` 失败**不要** `sys.exit()`：窗口已开着，登录照样做得完，只打印提示。
- **不自动点「登录」按钮**：各站登录入口改版频繁，写死选择器必脆；让用户自己点更稳。
- 桌面入口用 `choice /c 123456780` 单键菜单（1-7 各平台 / 8 全部依次 / 0 退出），每个平台跑完 `pause` 回菜单。
- 交付时**桌面 bat 与项目内 py 一起给**：用户双击的是桌面 bat，逻辑在项目根。

### 验证登录态真的写对了（硬证据）

```powershell
(Get-ChildItem "$prj\browser_data\xhs_user_data_dir" -Recurse -File).Count
```

跑登录脚本前后各数一次，**数字必须变化**（本机实测一次 +41 个文件）。
**目录存在不足以证明成功** —— 空目录和写好登录态的目录同样「存在」。

### 边界

- Cookie 有有效期（小红书约一个月，抖音更短）→ 过期重跑登录脚本即可。
- 登录态目录与抓取脚本共用，**一次登录对 search / detail 两种模式都有效**。

## 一键抓取脚本的约定

- **GBK / CP936**（`chcp 936 >nul`），零交互、双击即跑；关键词取 `%~1`，默认写死常用词。
- **日志一律落盘**到 `logs\<平台>_latest.log`，跑完回显 + `pause`。窗口一闪即关的脚本无法取证。
- **抓取期间 cmd 窗口不回显是设计**（stdout/stderr 重定向进日志）。bat 提示文案里必须写明「抓取期间本窗口不显示输出（日志正在写入文件），属正常现象」，否则用户会判断成「卡死」。
- 数据落 `data\<平台>\json\*.json`。

## 用户报「脚本没动 / 窗口一闪就没了」时的取证顺序

**先给结论，再展开证据**：用户问「为什么脚本没动」，就直接回答那一个问题，不要顺手把数据清单和后续分析一起倒出来。

1. 读 `logs\<平台>_latest.log` 最后几行，看落在哪一步：
   - `waiting for scan code login` → 二维码已出，在等扫码
   - `Login status confirmed by Cookie` → 登录成功
   - `Search notes response` → 数据到手，正在抓详情/评论
2. 看 `data\<平台>\json\` 的文件与 mtime —— 在写就是在干活
3. 按命令行找 `Project_MediaCrawler` / `ms-playwright` 进程 —— 还活着就是还在跑

**两条必须主动澄清的误会**（几乎每次都会发生，别等用户问）：

- 「那个浏览器像 Chrome」→ 那是 Playwright 自带 Chromium，同内核同外观，**不是用户的浏览器**；用户自己的 Edge/Chrome 一点没被碰。
- 「脚本没动」→ 见上「窗口不回显是设计」：抓取正常，只是不刷屏。

## 等待时长与登录方式的真相

- 日志文案写 `remaining time is 120s / 20s`，实际装饰器为 `stop_after_attempt(600), wait_fixed(1)` ⇒ **真实等待约 10 分钟**。别按日志文案判超时。
- **贴吧 / 知乎的 `login_by_mobile` 是空实现（`pass`）** ⇒ 只能 `--lt qrcode` 或 `--lt cookie`，**不能用 `--lt phone`**。
- xhs 的 `login_by_qrcode()` 里两次取不到二维码会执行 `sys.exit()` ⇒ 浏览器窗口随之关闭且无提示。用户说的「窗口加载一会儿就没了」多半是这个。
- 二维码选择器：xhs `img.qrcode-img`；bili `div.login-scan-box > img`；tieba `img.tang-pass-qrcode-img`；zhihu `canvas.Qrcode-qrcode`（canvas 截图）。
- `utils.show_qrcode()` 用 PIL `Image.show()` 额外弹一个系统看图器窗口，同时浏览器窗口也停在登录页 —— 两个窗口都出现是正常的。

## 读日志的实用技巧

日志含中文与长 JSON，SSH 侧读取时用 ASCII 折叠（非 ASCII 替换成 `.`）只保留结构行，避免整段 JSON 灌满上下文：

```powershell
function A([string]$s){ if($s){ ($s -replace '[^\x20-\x7e]','.') } else { '' } }
Get-Content $log -Tail 30 -Encoding UTF8 | ForEach-Object { A $_ }
```

## 资源

单实例 Chromium 约 0.5–1.5 GB。PC 只有 15.6 GB 物理内存，跑抓取前**先报备内存并确认 ComfyUI 没在跑**（ComfyUI 单实例提交量可达 14 GB）。

## 平台内容与调研结论的衔接

抓回来的 JSON 字段：`note_id / type / title / desc / tag_list / nickname / liked_count / collected_count / comment_count / note_url / xsec_token / time(ms)`。
筛选交付时：

- 标题与正文带 `#话题[话题]#` 与 `[表情R]` 噪声，先正则清洗再展示。
- 关键词搜索结果会**偏离意图**：搜「手办柜」会大量返回「痛柜」（谷子收纳文化）内容。要按用户的真实场景（买家具 / 找现货 / 特定尺寸）二次筛，而不是把 20 条原样倒给用户。
- `note_url` 已含 `xsec_token`，可直接给出供用户点开。
