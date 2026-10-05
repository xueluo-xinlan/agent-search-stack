#!/usr/bin/env bash
# Hermes 网络后端开关 —— 默认免费档；额度后端（Tavily/Brave/…）由人手动开、手动关。
#
# 为什么要「显式锁定」而不是留空自动检测：
#   Hermes 的自动检测顺序里 Tavily/Exa 等都排在 SearXNG 前面，一旦 .env 里存在 key，
#   搜索就会自作主张切走。要满足「开不开由我说了算」，off 时必须把 search_backend
#   显式锁成 searxng，而不是 unset（unset = 自动检测 = key 一存在就漂移）。
#
# 用法:
#   web_backend.sh                         # 同 status
#   web_backend.sh status                  # 当前用哪家 + 密钥/额度
#   web_backend.sh on <vendor>             # 开启：搜索切到该家  (tavily|brave|exa|parallel)
#   web_backend.sh on <vendor> extract     # 开启：搜索 + 抓取都切过去
#   web_backend.sh off                     # 关闭：搜索回 searxng、抓取回 exa（免费档）
#   web_backend.sh quota                   # 查 Tavily 用量（Brave 只能看 dashboard）
#
# 改完即时生效，无需重启网关。
set -uo pipefail

ENVF="~/.hermes/.env"
CFG_SEARCH="web.search_backend"
CFG_EXTRACT="web.extract_backend"
DEFAULT_SEARCH="searxng"
DEFAULT_EXTRACT="exa"

_vendor_cfg() {  # 口语名 -> config 后端名
  case "$1" in
    brave|brave-free) echo "brave-free" ;;
    tavily|exa|parallel|firecrawl|keenable) echo "$1" ;;
    *) echo "" ;;
  esac
}
_vendor_key() {  # config 后端名 -> 密钥变量
  case "$1" in
    brave-free) echo "BRAVE_SEARCH_API_KEY" ;;
    tavily) echo "TAVILY_API_KEY" ;;
    exa) echo "EXA_API_KEY" ;;
    parallel) echo "PARALLEL_API_KEY" ;;
    firecrawl) echo "FIRECRAWL_API_KEY" ;;
    keenable) echo "KEENABLE_API_KEY" ;;
    *) echo "" ;;
  esac
}
_has_key() {
  local var="$1" line
  [ -z "$var" ] && return 1
  line="$(grep -E "^${var}=" "$ENVF" 2>/dev/null | head -1)"
  [ -n "${line#*=}" ] && [ "${line#*=}" != "''" ] && [ "${line#*=}" != '""' ] && return 0
  [ -n "${!var:-}" ] && return 0
  return 1
}
_cfg_get() { hermes config get "$1" 2>/dev/null | tail -1; }

status() {
  local sb eb mode
  sb="$(_cfg_get $CFG_SEARCH)";  [ -z "$sb" ] && sb="(未设 → 自动检测)"
  eb="$(_cfg_get $CFG_EXTRACT)"; [ -z "$eb" ] && eb="(未设 → 自动检测)"
  mode="🔒 免费档（默认）"
  case "$sb" in tavily|brave-free|exa|parallel|firecrawl) mode="🔓 额度后端：$sb" ;; esac
  echo "模式         : $mode"
  echo "搜索后端     : $sb"
  echo "抓取后端     : $eb"
  echo
  printf '%-12s %-12s %-8s %s\n' "后端" "能力" "密钥" "额度 / 备注"
  printf '%-12s %-12s %-8s %s\n' "------------" "------------" "--------" "-----------------------------------"
  local row name cap var note mark
  for row in \
    "searxng|搜索|SEARXNG_URL|无上限（VPS 自建，引擎仅 bing/yandex/360）" \
    "exa|搜索+抓取|EXA_API_KEY|免钥环可用；有钥走付费额度" \
    "tavily|搜索+抓取|TAVILY_API_KEY|免钥环可用；官方免费 1000 credits/月" \
    "brave-free|仅搜索|BRAVE_SEARCH_API_KEY|必须密钥；官方免费 2000 次/月，不能抓取" \
    "parallel|搜索+抓取|PARALLEL_API_KEY|免钥环可用；有钥走付费额度" \
    "firecrawl|搜索+抓取|FIRECRAWL_API_KEY|免钥环可用；有钥走付费额度" ; do
    IFS='|' read -r name cap var note <<<"$row"
    if [ -z "$var" ]; then mark="—"; elif _has_key "$var"; then mark="已配"; else mark="未配"; fi
    printf '%-12s %-12s %-8s %s\n' "$name" "$cap" "$mark" "$note"
  done
  echo
  echo "开关：web_backend.sh on <tavily|brave|exa|parallel> [extract]     web_backend.sh off"
}

case "${1:-status}" in
  status|"") status ;;

  on)
    [ $# -ge 2 ] || { echo "用法: web_backend.sh on <vendor> [extract]" >&2; exit 1; }
    cfg="$(_vendor_cfg "$2")"
    [ -z "$cfg" ] && { echo "未知后端: $2（可选 tavily|brave|exa|parallel）" >&2; exit 1; }
    var="$(_vendor_key "$cfg")"
    if ! _has_key "$var"; then
      echo "✗ $cfg 还没配密钥（$var），无法开启。" >&2
      echo "  拿到密钥后写入：  printf '%s\\n' \"$var=你的密钥\" >> $ENVF  &&  chmod 600 $ENVF" >&2
      exit 1
    fi
    if [ "$cfg" = "brave-free" ] && [ "${3:-}" = "extract" ]; then
      echo "✗ Brave 不提供抓取能力；抓取请留在 exa/tavily/parallel。" >&2; exit 1
    fi
    hermes config set "$CFG_SEARCH" "$cfg" >/dev/null && echo "✓ 搜索后端 → $cfg"
    if [ "${3:-}" = "extract" ]; then
      hermes config set "$CFG_EXTRACT" "$cfg" >/dev/null && echo "✓ 抓取后端 → $cfg"
    fi
    echo "  （用完记得：web_backend.sh off）"
    ;;

  off)
    hermes config set "$CFG_SEARCH"  "$DEFAULT_SEARCH"  >/dev/null
    hermes config set "$CFG_EXTRACT" "$DEFAULT_EXTRACT" >/dev/null
    echo "✓ 已回免费档：搜索=$DEFAULT_SEARCH，抓取=$DEFAULT_EXTRACT"
    echo "  （显式锁定，.env 里留着密钥也不会自动漂移过去）"
    ;;

  quota)
    if _has_key TAVILY_API_KEY; then
      k="$(grep -E '^TAVILY_API_KEY=' "$ENVF" | head -1 | cut -d= -f2-)"
      echo "── Tavily 用量 ──"
      curl -s -m 15 https://api.tavily.com/usage -H "Authorization: Bearer $k" | head -c 600; echo
    else
      echo "Tavily 未配密钥。"
    fi
    echo "── Brave 用量 ── 无公开 API，去 https://api-dashboard.search.brave.com 看当月剩余"
    ;;

  *) sed -n '2,18p' "$0" ;;
esac
