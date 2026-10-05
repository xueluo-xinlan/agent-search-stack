#!/usr/bin/env bash
# taobao_search.sh —— VPS 侧入口：淘宝搜索（经 PC 抓取层 127.0.0.1:8191）
# 用法:
#   ~/taobao_search.sh "手办柜"
#   ~/taobao_search.sh "手办柜" --limit 30 --json
#   ~/taobao_search.sh "手办柜" --page 2
set -euo pipefail

if [ $# -lt 1 ]; then
  echo "用法: $0 \"关键词\" [--page N] [--limit N] [--json]" >&2
  exit 2
fi

KW="$1"; shift || true
EXTRA="$*"

PYEXE='C:\Users\you\AppData\Local\Programs\Python\Python311\python.exe'
D='C:\Users\you\flaresolverr_compat'
KW_PS=$(printf '%s' "$KW" | sed "s/'/''/g")

TMP=$(mktemp /tmp/tbsearch_XXXXXX.ps1)
trap 'rm -f "$TMP"' EXIT

cat > "$TMP" <<EOF
\$ErrorActionPreference='Continue'
[Console]::OutputEncoding=[Text.Encoding]::UTF8
\$out='$D\\_tb_cli.txt'
& '$PYEXE' '$D\\taobao_search.py' '$KW_PS' $EXTRA *>&1 | Out-File -FilePath \$out -Encoding utf8
"B64_START"
[Convert]::ToBase64String([IO.File]::ReadAllBytes(\$out))
"B64_END"
EOF

RAW=$(timeout 300 bash ~/pc_run.sh "$TMP" 2>&1 || true)
OUT=$(printf '%s' "$RAW" | sed -n '/B64_START/,/B64_END/p' | sed '1d;$d' | tr -d '\r\n')
if [ -z "$OUT" ]; then
  echo "[taobao_search] 未能取回结果，原始输出：" >&2
  printf '%s\n' "$RAW" | tail -n 20 >&2
  exit 1
fi
printf '%s' "$OUT" | base64 -d
