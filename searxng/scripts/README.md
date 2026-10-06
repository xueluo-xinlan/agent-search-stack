# SearXNG 运维脚本

这两个脚本是 SearXNG 实例的配套运维件，对应的 systemd 单元在本仓库 `searxng/systemd/` 下。

仓库里给的是**脚本**，不是编译好的服务；单元文件里的 `ExecStart` 指向 `/usr/local/bin/<脚本名>`，
请按下面的方式放置（或同步修改单元里的路径）。

## `searxng-hostnames-refresh.py`

**用途**：定时重建 SearXNG 的**域名移除清单**（`hostnames-remove.yml`，供 SearXNG 的 `hostnames` 插件使用），
用于在搜索结果层面剔除成人站与低质聚合站。

**原理**：拉取若干公开 hosts/域名黑名单源（如 StevenBlack hosts 的 unified 列表），过滤、归并后写出 YAML。

**部署**：

```bash
sudo install -m 755 searxng-hostnames-refresh.py /usr/local/bin/
sudo cp ../systemd/searxng-hostnames-refresh.service ../systemd/searxng-hostnames-refresh.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now searxng-hostnames-refresh.timer
```

> 脚本里有一处需要宿主环境配合的路径/命令（同步到另一次节点后重启服务），
> 使用前请先通读并按自己的环境改掉。

## `searxng-watchdog.py`

**用途**：**检测式**看门狗——只在引擎**真的**被停用时才重启 SearXNG。

**为什么需要**：SearXNG 的引擎被拦后会被"关小黑屋"（如 google 遇 CAPTCHA 停用 3600 秒、brave 遇 429 停用 120 秒，
失败累积还会升级）。这些停用状态存在**内存**里（未接 Redis 的实例），所以重启服务即可立刻解除；
但盲目定时重启大多数时候清的是没坏的引擎，纯属白重启。

**设计原则**：

1. 判据只看 SearXNG 自报的 `unresponsive_engines` 字段，不做抽样估算；
2. 全部正常 → 什么都不做；
3. 探针自身失败（网络异常/解析失败）**绝不**触发重启——只认"明确被停用"信号；
4. 冷却保护：两次重启至少间隔 `COOLDOWN_SECONDS`，防止永久失效引擎导致重启循环；
5. 重启后复验，把"是否真的恢复"写进日志。

**退出码**：`0` = 正常（含"已按需重启并恢复"）；`1` = 探针异常（无法判断，不重启）。便于 systemd 判读。

**部署**：

```bash
sudo install -m 755 searxng-watchdog.py /usr/local/bin/
sudo cp ../systemd/searxng-watchdog.service ../systemd/searxng-watchdog.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now searxng-watchdog.timer
```
