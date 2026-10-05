# SearXNG 搜索质量排障记录（2026-08-28）

> 现象：偏门/长尾中文查询返回大量垃圾结果（porn、YouTube Help、Microsoft 帮助页、Blox Fruits、Avengers 漫威测验等）。
> 根因：searxng 容器直连 UCloud 香港机房 IP（101.36.107.146），被 bing/google 标记为低信誉流量，返回降级垃圾页。
> 修复：searxng 走宿主机 mihomo 代理（日本节点），bing/google 恢复真实结果。

## 目录
1. [现象与排查过程](#1-现象与排查过程)
2. [根因分析](#2-根因分析)
3. [修复方案](#3-修复方案)
4. [修复后验证](#4-修复后验证)
5. [遗留问题](#5-遗留问题)
6. [配置速查](#6-配置速查)

## 1. 现象与排查过程

### 1.1 初始症状
- 热门查询（量子计算、GPT-5.2）质量尚可
- 偏门查询（羌笛制作、辉光放电、RISC-V 向量扩展）严重跑偏：
  - bing 返回 `gtnartscollege.ac.in`（印度成绩单）、`lk21id.com`（印尼盗版站）、YouTube Help、Microsoft 主页
  - score 1.0 置顶，把 google cse/bilibili 的好结果挤下去
- duckduckgo 持续 CAPTCHA、brave 持续限流

### 1.2 关键排查步骤
1. **验证引擎可用性**：`curl searxng /search?format=json` 查看各引擎返回
2. **发现 bing 返回固定垃圾**：搜"羌笛 制作"→ Berlin-Potsdam 路线规划（德语）、暴雪韩文论坛、iTunes 日文页——每次不同但都无关
3. **测试不同 language 参数**：zh-CN/zh-HK/de-DE/auto 都返回不同垃圾组 → 不是 locale 配置问题
4. **直连 vs 代理对比**：
   - 宿主机直连 bing → 正常 b_results（`curl https://www.bing.com/search?q=羌笛`）
   - searxng 容器内直连 → `honke-daiichiasahi.com`（日本站）等垃圾
   - **结论：容器出口 IP 是问题**

### 1.3 出口 IP 定位
```
docker exec searxng-main python3 -c "import urllib.request; print(urllib.request.urlopen('https://api.ipify.org').read().decode())"
# → 101.36.107.146
```
- IP 归属：`UCLOUD INFORMATION TECHNOLOGY (HK) LIMITED`，AS135377，香港机房
- **香港机房 IP 被 bing/google 标记为低信誉** → 返回降级页

## 2. 根因分析

### 2.1 垃圾页的本质
bing/google 对低信誉 IP（数据中心/机房）的搜索请求返回**降级兜底页**：
- 直连（UCloud HK）→ porn、YouTube Help、Microsoft
- 走 mihomo 美国节点（108.181.24.41）→ Blox Fruits、Solihull 火车站、西雅图动物园
- 走 mihomo 日本节点（103.62.49.138）→ KONAMI eFootball、Microsoft

**垃圾内容随出口 IP 变，但永远是垃圾** —— 搜索引擎对不可信 IP 返回泛内容，不解析查询。

### 2.2 为什么走代理后变好
- mihomo 节点出口（日本/美国）是**普通 VPS 机房 IP**，信誉略好于 UCloud 香港
- 关键是 **bing 日本节点对亚洲内容覆盖好**，热门中文查询（量子计算、GPT-5.2）能返回相关结果
- google cse（API 引擎）不受 IP 信誉影响，一直质量最高

### 2.3 引擎现状（2026-08-28 实测）
| 引擎 | 状态 | 质量 |
|---|---|---|
| bing | ✅ 走日本节点后恢复 | 热门查询好，长尾中文仍弱 |
| google cse | ✅ 正常（偶尔限流） | **最高**，精准命中 |
| bilibili | ✅ 正常 | 中文内容好 |
| wikipedia/github/stackoverflow/reddit/news | ✅ 正常 | 稳定 |
| duckduckgo | ❌ CAPTCHA | 长期不可用 |
| brave | ❌ too many requests | 长期限流 |
| google（原生） | ⚠️ 返回空壳页 | 不可用 |
| startpage | ❌ 已禁用 | CAPTCHA |

## 3. 修复方案

### 3.1 searxng 配置代理（/etc/agent-search/settings.yml）
```yaml
outgoing:
  proxies:
    all://:
      - http://172.17.0.1:7897
    https://:
      - http://172.17.0.1:7897
```
- 用 `172.17.0.1`（docker bridge 网关 = 宿主机）而非 `host.docker.internal`（容器内解析不了）
- 指向宿主机 mihomo mixed-port 7897

### 3.2 mihomo 强制搜索走日本节点（/etc/mihomo/config.yaml）
```yaml
rules:
  - DOMAIN-SUFFIX,bing.com,日本
  - DOMAIN-SUFFIX,google.com,日本
  - DOMAIN-SUFFIX,googleapis.com,日本
  - DOMAIN-SUFFIX,gstatic.com,日本
  - GEOIP,CN,DIRECT
  - MATCH,PROXY
```
- 这样无论 PROXY 组怎么切，搜索流量稳定走日本节点

### 3.3 mihomo PROXY 默认节点改日本
```yaml
  - name: "PROXY"
    type: select
    proxies:
      - "日本"        # 第一位 = 默认选中
      - "自动选择"
      - "新加坡"
      - "美国"
      - "台湾"
```

### 3.4 bing 降权（~/agent_search_gateway/gateway.yaml）
```yaml
rerank:
  engine_boost:
    bing: 0.7     # 原 1.0，长尾中文弱，降权避免垃圾置顶
```
- 重启网关生效

## 4. 修复后验证

### 4.1 连接确认
```
curl http://127.0.0.1:9090/connections | grep bing
# → www.bing.com -> ['🇯🇵日本东京03-0.1倍', '日本', 'PROXY']  ✅
```

### 4.2 搜索质量对比
| 查询 | 修复前 | 修复后 |
|---|---|---|
| 量子计算 最新进展 | 部分相关（靠 google cse） | ✅ 墨问/知乎/澎湃全相关 |
| GPT-5.2 发布 | 一般 | ✅ 302.AI/香港01 相关 |
| RISC-V 向量扩展 | 印度成绩单/垃圾 | ✅ google cse 给出赛昉/玄铁精准命中 |
| 羌笛 制作 工艺 非遗传人 | porn/YouTube 垃圾 | ⚠️ bing 仍弱，bilibili 有相关 |

## 5. 遗留问题

1. **bing 长尾中文查询仍弱**：eFootball/Avengers 等泛内容，bing 固有问题（对组合查询匹配差），降权缓解但未根治
2. **duckduckgo CAPTCHA / brave 限流**：长期问题，未解决；可考虑给它们单独配代理或换引擎
3. **google cse 偶尔限流**：测试频繁时触发 Suspended，通常几分钟后自动恢复
4. **mihomo 重启后**：PROXY 默认选中第一个（日本），已通过配置保证

## 6. 配置速查

| 配置项 | 路径 | 说明 |
|---|---|---|
| searxng 代理 | `/etc/agent-search/settings.yml` → `outgoing.proxies` | 指向 172.17.0.1:7897 |
| mihomo 规则 | `/etc/mihomo/config.yaml` → `rules` | bing/google 走日本 |
| mihomo PROXY 默认 | `/etc/mihomo/config.yaml` → `proxies` 顺序 | 日本第一位 |
| bing 降权 | `~/agent_search_gateway/gateway.yaml` → `rerank.engine_boost.bing` | 0.7 |

### 重启命令
```bash
# searxng（改 settings.yml 后）
docker restart searxng-main

# mihomo（改 config.yaml 后热重载，不重启）
curl -X PUT http://127.0.0.1:9090/configs -H "Content-Type: application/json" -d '{"path": "/etc/mihomo/config.yaml"}'

# agent_search_gateway（改 gateway.yaml 后）
# 通过 hermes gateway 管理，重启 hermes 或对应 MCP 服务
```

### 排查工具
```bash
# 容器出口 IP
docker exec searxng-main python3 -c "import urllib.request; print(urllib.request.urlopen('https://api.ipify.org').read().decode())"

# 走代理出口 IP
curl -x http://127.0.0.1:7897 https://api.ipify.org

# 查 mihomo 当前选中节点
curl http://127.0.0.1:9090/proxies/PROXY | python3 -m json.tool | grep now

# 查 mihomo 连接走向
curl http://127.0.0.1:9090/connections

# 手动测试 bing（HTML 格式）
curl -x http://127.0.0.1:7897 "https://www.bing.com/search?q=测试&mkt=zh-CN" -A "Mozilla/5.0"
```
