# SearXNG Tavily 引擎

为 SearXNG 接入 [Tavily Search API](https://docs.tavily.com)（AI 搜索 API，走官方 API 不受出口 IP 信誉/反爬影响，中文质量高）。

## 文件说明

| 文件 | 说明 |
|---|---|
| `tavily.py` | 引擎实现，来自 [searxng/searxng PR #6499](https://github.com/searxng/searxng/pull/6499)（AGPL-3.0），未合入主分支 |
| `settings.yml.example` | 脱敏配置模板（API key 用占位符） |

## 前提

1. 在 https://app.tavily.com 注册获取 API key（免费 1000 credits/月，**无需信用卡**）
   - `basic` 深度 = 1 credit/次，`advanced` = 2 credit/次
2. 将 `tavily.py` 放入 searxng 引擎目录

## 接入

**源码部署（本机）**
```bash
cp tavily.py <searxng>/searx/engines/tavily.py
# 在 settings.yml 添加引擎块（见 settings.yml.example）
# 重启 searxng
```

**Docker 部署（VPS）**

引擎文件持久化（推荐挂载 volume，容器重建不丢）：
```bash
# 把 tavily.py 放到宿主机目录，如 /etc/agent-search/engines/tavily.py
# 重建容器时挂载：
#   -v /etc/agent-search/engines:/usr/local/searxng/searx/engines:ro
```

settings.yml 通过 bind mount 注入（本机约定 `/etc/agent-search/settings.yml`），编辑后重启容器：
```bash
docker restart searxng-main
```

## 验证

```bash
# 引擎是否启用
curl "http://127.0.0.1:8888/config" | grep tavily
# 单独测 tavily
curl "http://127.0.0.1:8888/search?q=测试&format=json&engines=tavily"
```

## 许可

`tavily.py` 为 [AGPL-3.0-or-later](https://www.gnu.org/licenses/agpl-3.0.html)，与 SearXNG 本身许可证一致。
