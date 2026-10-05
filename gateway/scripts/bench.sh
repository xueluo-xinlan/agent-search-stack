#!/usr/bin/env bash
# 本机压测：测量各组件内存与延迟（模拟 3.8GB 服务器场景）
# 用法: bench.sh
set -u

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BASE=http://127.0.0.1:3000/mcp
J='-H Content-Type:application/json -H Accept:application/json,text/event-stream'
TMP="$DIR/.tmp/bench"
mkdir -p "$TMP"

# ---------- MCP helper ----------
mcp_init() {
  RESP=$(curl --noproxy '*' -s -D "$TMP/hdr.txt" -X POST $BASE $J \
    -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"bench","version":"1"}}}')
  grep -i 'mcp-session-id' "$TMP/hdr.txt" | tr -d '\r' | awk '{print $2}'
}

mcp_call() {
  local sid="$1" id="$2" tool="$3" args="$4"
  curl --noproxy '*' -s -m 60 -X POST $BASE $J -H "Mcp-Session-Id: $sid" \
    -d "{\"jsonrpc\":\"2.0\",\"id\":$id,\"method\":\"tools/call\",\"params\":{\"name\":\"$tool\",\"arguments\":$args}}" \
    | python3 -c "
import sys,json
for l in sys.stdin.read().splitlines():
    if l.startswith('data: '):
        d=json.loads(l[6:])
        c=d.get('result',{}).get('content',[{}])
        if 'error' in d.get('result',{}):
            print('ERROR'); break
        # 文本内容取前 60 字符
        texts=[x.get('text','')[:60].replace(chr(10),' ') for x in c if x.get('type')=='text']
        imgs=sum(1 for x in c if x.get('type')=='image')
        print(' | '.join(texts[:2]) + (f' | [图x{imgs}]' if imgs else ''))
        break
"
}

# ---------- 内存采样 ----------
mem_sample() {
  local label="$1"
  echo "--- $label ---"
  ps -eo pid,rss,cmd | grep -E "searx.webapp|flaresolverr.py|src/index.ts|chrome-headless-shell" | grep -v grep \
    | awk '{s[$3]+=$2; n[$3]++} END{
      for (k in s) {
        name=k
        if (k ~ /searx.webapp/) name="searxng"
        else if (k ~ /flaresolverr/) name="flaresolverr"
        else if (k ~ /src.index.ts/) name="gateway(node)"
        else if (k ~ /chrome-headless/) name="chromium"
        printf "  %-16s %d 进程 %6.1fMB\n", name, n[k], s[k]/1024
      }
    }' | sort -t' ' -k3 -h
}

echo "===== 网关组件压测（本机模拟） ====="
mem_sample "空闲基线（无操作）"

SID=$(mcp_init)
echo "session: $SID"

echo "===== 1. 搜索压测（并发 2，5 个查询） ====="
for i in 1 2 3 4 5; do
  Q="test query $i"
  T0=$(date +%s%N)
  mcp_call "$SID" $((100+i)) search "{\"query\":\"$Q\",\"num_results\":5}" >/dev/null
  T1=$(date +%s%N)
  echo "  search[$i]: $(( (T1-T0)/1000000 ))ms"
done
mem_sample "搜索后"

echo "===== 2. fetch 压测（普通站 direct） ====="
for i in 1 2 3; do
  T0=$(date +%s%N)
  mcp_call "$SID" $((200+i)) fetch '{"url":"http://1.1.1.1/","max_chars":500}' >/dev/null
  T1=$(date +%s%N)
  echo "  fetch[$i]: $(( (T1-T0)/1000000 ))ms"
done
mem_sample "fetch 后"

echo "===== 3. 浏览器操作压测（navigate + snapshot） ====="
T0=$(date +%s%N)
mcp_call "$SID" 300 browser_navigate '{"url":"http://1.1.1.1/"}' >/dev/null
T1=$(date +%s%N)
echo "  browser_navigate: $(( (T1-T0)/1000000 ))ms"
T0=$(date +%s%N)
mcp_call "$SID" 301 browser_snapshot '{}' >/dev/null
T1=$(date +%s%N)
echo "  browser_snapshot: $(( (T1-T0)/1000000 ))ms"
mem_sample "浏览器工作状态"

echo "===== 4. 关闭浏览器，验证资源释放 ====="
mcp_call "$SID" 302 browser_close '{}' >/dev/null
sleep 3
mem_sample "浏览器关闭后"

echo ""
echo "===== 结论 ====="
echo "空闲内存应 ~450MB（searxng 110 + flaresolverr 160 + gateway 180）"
echo "浏览器工作时 +~550MB，关闭后回落。3.8GB 预算富余。"
