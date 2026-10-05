---
name: mediacrawler-cn-platforms
version: 1.0.0
description: "Use when scraping Chinese social platforms via MediaCrawler."
author: hermes-agent
license: MIT
platforms: [windows]
metadata:
  hermes:
    tags: [MediaCrawler, China, Scraping, Bilibili, Tieba, Zhihu, XHS, QR-Login]
    category: research
    related_skills: [chinese-community-gear-research, chinese-site-access-triage, windows-remote-ssh-admin]
---

# MediaCrawler 中文平台抓取（PC 侧）

在用户的 Windows PC 上跑 MediaCrawler，抓小红书 / B站 / 贴吧 / 知乎 / 微博 / 抖音 / 快手的
搜索内容与评论。**七个平台全部支持手机扫码登录** —— 不需要用户手工复制 cookie。

## When to Use（何时用）

- 用户要某中文平台的真实用户内容（推荐、口碑、吐槽），且搜索引擎索引不够用。
- 用户问「XX 能不能扫码登录」/「为什么只能做小红书」。
- 需要在 PC 上跑需要登录态的中文站抓取（B站搜索、知乎搜索、贴吧搜索）。

## 部署事实（现成，勿重建）

| 项 | 值 |
|---|---|
| 项目目录 | `C:\Users\you\Project_MediaCrawler`（`main` 分支，HEAD `5d547f4`） |
| 依赖 | `uv sync` 已装；独立 Chromium 在 `%LOCALAPPDATA%\ms-playwright\chromium-1228` |
| 解释器 | `C:\Users\you\AppData\Local\hermes\bin\uv.exe`（**bat 里必须写绝对路径**） |
| 一键脚本 | 同目录 `run_{xhs,bili,tieba,zhihu,weibo,douyin,kuaishou}.bat`（GBK、零交互、双击即跑） |
| 数据落盘 | `data\<平台>\*.json`（store 目录名 = `bilibili/tieba/zhihu/weibo/douyin/kuaishou/xhs`） |
| 登录态 | `browser_data\<平台>_user_data_dir\`（`SAVE_LOGIN_STATE=True`，扫一次长期复用） |
| 生成器 | VPS `~/build/mk_mc_bats.py`（改关键词/模板后重跑即可） |

执行命令（脚本内就是这一条）：

```bat
uv run main.py --platform <xhs|dy|ks|bili|wb|tieba|zhihu> --lt qrcode --type search --keywords "手办柜" --save_data_option json
```

## 扫码登录的源码级事实（别凭猜）

- **七个平台都实现了 `login_by_qrcode`**：`media_platform/<p>/login.py` 里 `begin()` 按
  `config.LOGIN_TYPE` 分派 `qrcode` / `phone` / `cookie`（有的平台 `login_by_mobile` 是空 `pass`）。
  二维码选择器各不相同：xhs `img.qrcode-img`、bili `//div[@class='login-scan-box']//img`、
  tieba `img.tang-pass-qrcode-img`、zhihu `canvas.Qrcode-qrcode`（canvas 走截图）、weibo `img.w-full.h-full`。
- **二维码展示 = 两条路同时给**：`utils.show_qrcode()` 用 PIL `Image.show()` 弹系统默认看图器，
  **同时**浏览器窗口本身也停在登录页显示二维码。告诉用户扫哪个都行。
- **等待时长被日志文案骗了**：各文件写「remaining time is 20s / 120s」，但 `check_login_state`
  的装饰器是 `stop_after_attempt(600), wait_fixed(1)` ⇒ **实际约 10 分钟**。用户不必抢秒。
- 登录成功的判据（cookie）：xhs 看登录 cookie、bili 看 **SESSDATA 前后值是否换发**（新逻辑，
  能区分「真的登录了」与「只剩过期 cookie」）、tieba 看 `STOKEN`/`PTOKEN`、zhihu 看 `z_c0`。
- `--help` 能跑通 = 七个平台的 crawler 模块 `import` 全部成功（`CrawlerFactory.CRAWLERS` 在
  模块级引用了它们）；这是无副作用的端到端导入验证。

## 安全化配置（首次部署已改，勿回退）

`config/base_config.py`：

```
ENABLE_CDP_MODE      = False   # 原 True —— 开着会去连用户日常浏览器
CDP_CONNECT_EXISTING = False   # 原 True —— 默认「连接已打开的浏览器」，事故配方
KEYWORDS             = "手办柜"
SAVE_DATA_OPTION     = "json"
CRAWLER_MAX_NOTES_COUNT = 30
```

原文件备份为 `config/base_config.py.orig-20261006`。**这两行 CDP 开关是安全关键**：
开着就会通过 `--remote-debugging-port=9222` 接管用户自己开着的浏览器。

## 交付与验证纪律

1. **扫码必须由用户在本机桌面双击 .bat** —— SSH 侧进程在 session 0，看不到桌面窗口；
   替不了，也不要尝试用计划任务偷跑（会弹出用户没预期的浏览器窗口）。
2. bat 生成后**逐字节校验**：VPS `md5sum` vs PC `Get-FileHash -Algorithm MD5`，大小与哈希都要对上。
3. bat 必须 **GBK/CP936** 落盘（`txt.replace('\n','\r\n').encode('gbk')`），否则 cmd 读中文注释会拆出
   非法命令；脚本**内容保持纯 ASCII 注释更稳**。
4. **不要在 bat 里裸写 `uv`**：用户双击时的 PATH 与 SSH 会话不同，实测存在 `uv.exe` 在
   `AppData\Local\hermes\bin` 但 PATH 未收录的形态。写法：
   `set "UV=<绝对路径>"` + `if not exist "%UV%" set "UV=uv"` + `"%UV%" run ...`。
5. **抓取是一次性重型进程**：一个 Chromium 约 0.5–1.5 GB 内存。开工前按用户规范报备，
   提醒别与 ComfyUI 同时跑；跑完确认进程已退（`data\` 有新文件 = 跑过了）。

## 抓完怎么用

- 数据是 `data\<平台>\*.json`（笔记/视频/帖子正文 + 评论）。取回 VPS 用 base64 + SHA256
  （见 `windows-remote-ssh-admin`，scp 取回会静默截断）。
- 关键词可多组：`--keywords "手办柜,展示柜"`（英文逗号）。改默认值就改 bat 里的 `set "KW="`。
- 想换数量改 `config/base_config.py` 的 `CRAWLER_MAX_NOTES_COUNT`（当前 30）与
  `CRAWLER_MAX_COMMENTS_COUNT_SINGLENOTES`（当前 10）。

## Pitfalls

- **登录态按平台隔离**：七个平台要各扫一次码，没有「一次扫码全通」。跑第二个平台时会再弹一次。
- **同一平台登录态过期**（数周到数月）后再跑，会重新弹二维码 —— 属正常，不是脚本坏了。
- **不要用「data 目录不存在」推断脚本坏了**：它只说明还没跑过。
- **贴吧/知乎的 `login_by_mobile` 是空的**（`pass`），`--lt phone` 会静默什么都不做；只用 `qrcode` 或 `cookie`。
- B站首页登录入口选择器写死在 `media_platform/bilibili/login.py` 的 `LOGIN_ENTRY_SELECTORS`，
  某天 B站改版会导致 `Login entry not found` 并 `sys.exit()` —— 那时更新该常量即可，不是环境坏了。
