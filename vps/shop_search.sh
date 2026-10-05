#!/usr/bin/env bash
# shop_search.sh —— VPS 侧入口：多站商品搜索（经 PC 抓取层 127.0.0.1:8191）
#
# 用法:
#   ~/shop_search.sh dangdang "手办"
#   ~/shop_search.sh smzdm "手办" --limit 10 --json
#   ~/shop_search.sh taobao "手办柜"
#
# 站点与登录依赖（2026-10 实测）:
#   dangdang —— 免登录        ：书名/现价/原价/折扣
#   smzdm    —— 免登录        ：好价爆料，带平台标注（京东/拼多多…），价格含前价
#   taobao   —— 需淘宝登录态  ：商品/价格/销量（profile 内已有登录态）
set -euo pipefail

if [ $# -lt 2 ]; then
  echo "用法: $0 <dangdang|smzdm|taobao> \"关键词\" [--limit N] [--json]" >&2
  exit 2
fi

SITE="$1"; KW="$2"; shift 2 || true
EXTRA="$*"

PYEXE='C:\Users\you\AppData\Local\Programs\Python\Python311\python.exe'
D='C:\Users\you\flaresolverr_compat'
KW_PS=$(printf '%s' "$KW" | sed "s/'/''/g")

TMP=$(mktemp /tmp/shopsearch_XXXXXX.ps1)
trap 'rm -f "$TMP"' EXIT

cat > "$TMP" <<EOF
\$ErrorActionPreference='Continue'
[Console]::OutputEncoding=[Text.Encoding]::UTF8
\$out='$D\\_shop_cli.txt'
& '$PYEXE' '$D\\shop_search.py' '$SITE' '$KW_PS' $EXTRA *>&1 | Out-File -FilePath \$out -Encoding utf8
"B64_START"
[Convert]::ToBase64String([IO.File]::ReadAllBytes(\$out))
"B64_END"
EOF

RAW=$(timeout 300 bash ~/pc_run.sh "$TMP" 2>&1 || true)
OUT=$(printf '%s' "$RAW" | sed -n '/B64_START/,/B64_END/p' | sed '1d;$d' | tr -d '\r\n')
if [ -z "$OUT" ]; then
  echo "[shop_search] 未取回结果，原始输出尾部：" >&2
  printf '%s\n' "$RAW" | tail -n 15 >&2
  exit 1
fi
printf '%s' "$OUT" | base64 -d
