#!/usr/bin/env bash
# agent_search_gateway 统一管理脚本
# 用法: gateway.sh {start|stop|restart|status|logs} [component]
#   component: searxng | flaresolverr | gateway | all (默认 all)
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SEARXNG_DIR="$HOME/Projects/searxng"
FLARESOLVERR_DIR="$HOME/Projects/FlareSolverr"
CONDA_BIN="$HOME/miniconda3/bin"
LOG="$DIR/gateway.log"
SEARXNG_PORT=8888
FLARESOLVERR_PORT=8192

SEARXNG_SH="$SEARXNG_DIR/searxng.sh"
GATEWAY_YAML="$DIR/gateway.yaml"
LOG="$DIR/gateway.log"

log() { echo "[gateway] $*"; }

# 从 gateway.yaml 读取端口（默认 3000）
gateway_port() {
  if [ -f "$GATEWAY_YAML" ]; then
    python3 -c "
import yaml,sys
try:
    d=yaml.safe_load(open('$GATEWAY_YAML'))
    print(d.get('gateway',{}).get('port',3000))
except Exception:
    print(3000)
" 2>/dev/null || echo 3000
  else
    echo 3000
  fi
}

# ---------- searxng ----------
searxng_start() {
  if [ -f "$SEARXNG_SH" ]; then
    "$SEARXNG_SH" start
  else
    log "未找到 $SEARXNG_SH"
  fi
}
searxng_stop() {
  if [ -f "$SEARXNG_SH" ]; then "$SEARXNG_SH" stop; fi
}

# ---------- FlareSolverr ----------
flaresolverr_start() {
  if curl --noproxy '*' -s -o /dev/null -m 2 "http://127.0.0.1:$FLARESOLVERR_PORT/" 2>/dev/null; then
    log "flaresolverr 已在运行 (:$FLARESOLVERR_PORT)"
    return
  fi
  local pid
  pid=$(pgrep -f "flaresolverr.py" | head -1 || true)
  if [ -n "$pid" ]; then
    log "flaresolverr 进程已存在 (PID $pid)，尝试探测端口"
  else
    cd "$FLARESOLVERR_DIR"
    # 需要 conda 的 PATH (Xvfb)，并给独立端口 (Byparr 占 8191)
    PATH="$CONDA_BIN:$PATH" PORT=$FLARESOLVERR_PORT nohup .venv/bin/python src/flaresolverr.py \
      >> "$FLARESOLVERR_DIR/flaresolverr.log" 2>&1 < /dev/null &
    log "flaresolverr 已启动 (PID $!)，日志: $FLARESOLVERR_DIR/flaresolverr.log"
  fi
  sleep 3
}
flaresolverr_stop() {
  local pid
  pid=$(pgrep -f "flaresolverr.py" | head -1 || true)
  if [ -n "$pid" ]; then
    kill "$pid" 2>/dev/null && log "flaresolverr 已停止 (PID $pid)" || log "停止失败"
  else
    log "flaresolverr 未在运行"
  fi
}

# ---------- gateway ----------
gateway_start() {
  local gp
  gp=$(gateway_port)
  if curl --noproxy '*' -s -o /dev/null -m 2 "http://127.0.0.1:$gp/health" 2>/dev/null; then
    log "gateway 已在运行 (:$gp)"
    return
  fi
  cd "$DIR"
  if [ ! -f "$GATEWAY_YAML" ]; then
    cp "$DIR/gateway.yaml.example" "$GATEWAY_YAML"
    log "已从 gateway.yaml.example 创建 gateway.yaml"
  fi
  # 开发模式用 tsx；生产可先 npm run build 后 node dist/index.js
  if [ -x "$DIR/node_modules/.bin/tsx" ]; then
    nohup "$DIR/node_modules/.bin/tsx" src/index.ts >> "$LOG" 2>&1 < /dev/null &
  else
    log "未找到 tsx，请先 npm install"
    return 1
  fi
  log "gateway 已启动 (PID $!)，日志: $LOG"
  sleep 4
}
gateway_stop() {
  local pid
  # 先杀网关主进程（其 chromium 子进程会随之退出）
  pid=$(pgrep -f "src/index.ts" | head -1 || true)
  if [ -n "$pid" ]; then
    kill "$pid" 2>/dev/null && log "gateway 已停止 (PID $pid)" || log "停止失败"
  fi
  sleep 1
  # 清理可能残留的 playwright chromium（孤儿）
  local chromes
  chromes=$(pgrep -f "chrome-headless-shell" 2>/dev/null | tr '\n' ' ' || true)
  if [ -n "$chromes" ]; then
    kill -9 $chromes 2>/dev/null || true
    log "已清理 playwright chromium"
  fi
  if [ -z "$pid" ]; then
    log "gateway 未在运行"
  fi
}

# ---------- status ----------
probe() {
  local url="$1" name="$2"
  local code
  code=$(curl --noproxy '*' -s -o /dev/null -m 2 -w "%{http_code}" "$url" 2>/dev/null || echo "down")
  if [ "$code" = "000" ]; then code="down"; fi
  printf "  %-14s %s\n" "$name" "$code"
}

status() {
  local gp
  gp=$(gateway_port)
  log "组件状态:"
  probe "http://127.0.0.1:$SEARXNG_PORT/" "searxng:$SEARXNG_PORT"
  probe "http://127.0.0.1:$FLARESOLVERR_PORT/" "flaresolverr:$FLARESOLVERR_PORT"
  probe "http://127.0.0.1:$gp/health" "gateway:$gp"
}

logs() {
  local comp="${2:-gateway}"
  case "$comp" in
    searxng) tail -f "$SEARXNG_DIR/searxng.log" ;;
    flaresolverr) tail -f "$FLARESOLVERR_DIR/flaresolverr.log" ;;
    gateway) tail -f "$LOG" ;;
    *) log "logs 组件: searxng | flaresolverr | gateway"; exit 1 ;;
  esac
}

# ---------- dispatch ----------
CMD="${1:-status}"
COMP="${2:-all}"

case "$CMD" in
  start)
    case "$COMP" in
      searxng) searxng_start ;;
      flaresolverr) flaresolverr_start ;;
      gateway) gateway_start ;;
      all) searxng_start; flaresolverr_start; gateway_start; status ;;
      *) log "未知组件: $COMP"; exit 1 ;;
    esac
    ;;
  stop)
    case "$COMP" in
      searxng) searxng_stop ;;
      flaresolverr) flaresolverr_stop ;;
      gateway) gateway_stop ;;
      all) gateway_stop; flaresolverr_stop; searxng_stop ;;
      *) log "未知组件: $COMP"; exit 1 ;;
    esac
    ;;
  restart) "$0" stop "$COMP"; sleep 1; "$0" start "$COMP" ;;
  status) status ;;
  logs) logs "$COMP" ;;
  *) log "用法: $0 {start|stop|restart|status|logs} [searxng|flaresolverr|gateway|all]"; exit 1 ;;
esac
