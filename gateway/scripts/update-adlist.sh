#!/usr/bin/env bash
# 更新 StevenBlack hosts 广告过滤列表到本地
# 用法: update-adlist.sh [level]
#   level: ads | ads+tracking | full (默认读 gateway.yaml 的 ad_filter.level)
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
YAML="$DIR/gateway.yaml"

level="${1:-}"
if [ -z "$level" ]; then
  level=$(python3 -c "
import yaml,sys
try:
    d=yaml.safe_load(open('$YAML'))
    print(d.get('ad_filter',{}).get('level','ads'))
except Exception:
    print('ads')
" 2>/dev/null || echo ads)
fi

case "$level" in
  ads|ads+tracking) URL="https://raw.githubusercontent.com/StevenBlack/hosts/master/hosts" ;;
  full) URL="https://raw.githubusercontent.com/StevenBlack/hosts/master/alternates/fakenews/hosts" ;;
  off) echo "level=off，无需更新"; exit 0 ;;
  *) echo "未知 level: $level (ads|ads+tracking|full)"; exit 1 ;;
esac

DEST="$DIR/data/adblock/hosts"
mkdir -p "$(dirname "$DEST")"

echo "拉取 StevenBlack hosts ($level): $URL"
if curl --noproxy '*' -sSL -m 60 -o "$DEST" "$URL"; then
  n=$(grep -cE '^[0-9a-f:.]+\s+[a-z0-9.-]+' "$DEST" || true)
  echo "已更新: $DEST ($n 条)"
else
  echo "拉取失败，保留本地缓存"
  exit 1
fi
