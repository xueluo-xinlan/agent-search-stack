#!/usr/bin/env bash
# agent_search_gateway —— Docker 一键部署
#
#   ./scripts/docker-up.sh
#
# 做四件事：
#   1) 生成 .env（随机 GATEWAY_TOKEN，权限 600）
#   2) 生成 docker/searxng/settings.yml（随机 secret_key，权限 600）
#   3) docker compose up -d --build
#   4) 轮询 /health，打印后端状态与 MCP 接入信息
#
# 幂等：.env 与 settings.yml 已存在则不覆盖（不会踢掉正在用的 token）。

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$HERE"

C_INFO=$'\033[1;36m'; C_ERR=$'\033[1;31m'; C_OFF=$'\033[0m'
log() { printf '%s[docker-up]%s %s\n' "$C_INFO" "$C_OFF" "$*"; }
die() { printf '%s[docker-up] %s%s\n' "$C_ERR" "$*" "$C_OFF" >&2; exit 1; }

rand_hex() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex "$1"
  else
    head -c "$1" /dev/urandom | od -An -tx1 | tr -d ' \n'
  fi
}

# ---------- 0. 前置检查 ----------
command -v docker >/dev/null 2>&1 || die "未找到 docker，先装：https://docs.docker.com/engine/install/"
if docker compose version >/dev/null 2>&1; then
  DC=(docker compose)
elif command -v docker-compose >/dev/null 2>&1; then
  DC=(docker-compose)
else
  die "未找到 docker compose（推荐 v2 插件）"
fi
docker info >/dev/null 2>&1 || die "docker 守护进程不可用（需要启动 dockerd 或加 sudo）"

# ---------- 1. .env ----------
if [[ ! -f .env ]]; then
  log "生成 .env（随机 GATEWAY_TOKEN）"
  ( umask 077; {
      printf 'GATEWAY_TOKEN=%s\n' "$(rand_hex 24)"
      printf '# 可选：SearXNG 不可达时直连搜索降级用\n#TAVILY_API_KEY=\n'
      printf 'TZ=UTC\n'
    } > .env )
  chmod 600 .env
else
  log ".env 已存在，保留现有 token"
fi

set -a
# shellcheck disable=SC1091
. ./.env
set +a
[[ -n "${GATEWAY_TOKEN:-}" ]] || die ".env 中的 GATEWAY_TOKEN 为空"

# ---------- 2. SearXNG settings.yml ----------
SEARX_DIR="$HERE/docker/searxng"
mkdir -p "$SEARX_DIR"
if [[ ! -f "$SEARX_DIR/settings.yml" ]]; then
  SRC=""
  for cand in "$HERE/../searxng/settings.yml.example" "$HERE/settings.yml.example"; do
    if [[ -f "$cand" ]]; then SRC="$cand"; break; fi
  done
  [[ -n "$SRC" ]] || die "找不到 settings.yml.example（应在仓库的 searxng/ 目录下）"
  log "生成 docker/searxng/settings.yml（随机 secret_key）"
  ( umask 077
    sed "s|CHANGE_ME__openssl_rand_hex_32|$(rand_hex 32)|" "$SRC" > "$SEARX_DIR/settings.yml" )
  chmod 600 "$SEARX_DIR/settings.yml"
else
  log "docker/searxng/settings.yml 已存在，保留"
fi

# ---------- 3. 启动 ----------
log "构建并启动（首次构建会下载 chromium，约 150–200MB）"
"${DC[@]}" up -d --build

# ---------- 4. 健康检查 ----------
PORT="${GATEWAY_PORT:-3000}"
log "等待 http://127.0.0.1:${PORT}/health ..."
ready=0
for _ in $(seq 1 40); do
  if curl -fsS "http://127.0.0.1:${PORT}/health" >/dev/null 2>&1; then ready=1; break; fi
  sleep 3
done

"${DC[@]}" ps || true

if [[ "$ready" -eq 1 ]]; then
  curl -fsS "http://127.0.0.1:${PORT}/health" | { python3 -m json.tool 2>/dev/null || cat; }
  echo
  log "就绪。MCP 端点： http://127.0.0.1:${PORT}/mcp"
  log "鉴权头：Authorization: Bearer <./.env 里的 GATEWAY_TOKEN>"
  log "查看日志：${DC[*]} logs -f gateway"
else
  die "健康检查超时。看日志：${DC[*]} logs -f gateway"
fi
