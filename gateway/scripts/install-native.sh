#!/usr/bin/env bash
# agent_search_gateway —— 裸机部署（无 Docker，systemd）
#
#   sudo ./scripts/install-native.sh
#
# 做五件事：
#   1) 检查 node / npm 版本
#   2) npm ci + npm run build
#   3) npx playwright install --with-deps chromium
#   4) 生成 gateway.yaml 与 /etc/agent-search/gateway.env（随机 token，600）
#   5) 安装并启动 systemd 单元 agent-search-gateway.service
#
# SearXNG 与 FlareSolverr 不由本脚本安装：请在 gateway.yaml 里把
# searxng.url / flaresolverr.url 指到你自己的实例（默认 127.0.0.1:8888
# 与 127.0.0.1:8192）。searxng 的 systemd 单元见 ../../searxng/systemd/。
#
# 卸载： sudo systemctl disable --now agent-search-gateway && sudo rm /etc/systemd/system/agent-search-gateway.service

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$HERE"

SERVICE=agent-search-gateway
CONF_DIR=/etc/agent-search
ENV_FILE="$CONF_DIR/gateway.env"
UNIT=/etc/systemd/system/${SERVICE}.service
RUN_USER="${SUDO_USER:-$(id -un)}"

C_INFO=$'\033[1;36m'; C_ERR=$'\033[1;31m'; C_OFF=$'\033[0m'
log() { printf '%s[install]%s %s\n' "$C_INFO" "$C_OFF" "$*"; }
die() { printf '%s[install] %s%s\n' "$C_ERR" "$*" "$C_OFF" >&2; exit 1; }

rand_hex() {
  if command -v openssl >/dev/null 2>&1; then openssl rand -hex "$1";
  else head -c "$1" /dev/urandom | od -An -tx1 | tr -d ' \n'; fi
}

# ---------- 1. 前置检查 ----------
command -v node >/dev/null 2>&1 || die "未找到 node（需要 ≥ 20，建议 22/24 LTS）"
command -v npm  >/dev/null 2>&1 || die "未找到 npm"
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[[ "$NODE_MAJOR" -ge 20 ]] || die "node 版本过低（当前 $(node -v)，需 ≥ 20）"
NODE_BIN="$(command -v node)"
log "node $(node -v) / npm $(npm -v) / 运行用户 ${RUN_USER}"

if [[ "${EUID}" -eq 0 ]]; then SUDO=""; else SUDO="sudo"; fi

# ---------- 2. 构建 ----------
log "安装依赖并编译"
if [[ -f package-lock.json ]]; then npm ci --no-audit --no-fund; else npm install --no-audit --no-fund; fi
npm run build

# ---------- 3. chromium ----------
log "安装 chromium（含系统依赖，可能要求 sudo）"
npx playwright install chromium
$SUDO npx playwright install-deps chromium

# ---------- 4. 配置 ----------
if [[ ! -f gateway.yaml ]]; then
  cp gateway.yaml.example gateway.yaml
  log "已生成 gateway.yaml（请按需改 searxng.url / flaresolverr.url）"
else
  log "gateway.yaml 已存在，保留"
fi

$SUDO mkdir -p "$CONF_DIR"
if ! $SUDO test -f "$ENV_FILE"; then
  log "生成 $ENV_FILE（随机 GATEWAY_TOKEN）"
  TMP_ENV="$(mktemp)"
  umask 077
  {
    printf 'GATEWAY_TOKEN=%s\n' "$(rand_hex 24)"
    printf '#TAVILY_API_KEY=\n'
    printf 'NODE_ENV=production\n'
  } > "$TMP_ENV"
  $SUDO install -m 600 -o root -g root "$TMP_ENV" "$ENV_FILE"
  rm -f "$TMP_ENV"
else
  log "$ENV_FILE 已存在，保留现有 token"
fi

# ---------- 5. systemd ----------
log "写入单元 $UNIT"
TMP_UNIT="$(mktemp)"
cat > "$TMP_UNIT" <<EOF
[Unit]
Description=agent_search_gateway (MCP search/fetch gateway)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=${RUN_USER}
WorkingDirectory=${HERE}
EnvironmentFile=-${ENV_FILE}
ExecStart=${NODE_BIN} ${HERE}/dist/index.js
Restart=always
RestartSec=5
# 内存保护：浏览器池 + node 常驻，给 1.5G 上限，超出由 systemd 重启
MemoryMax=1536M
StandardOutput=journal
StandardError=journal
SyslogIdentifier=${SERVICE}

[Install]
WantedBy=multi-user.target
EOF
$SUDO install -m 644 "$TMP_UNIT" "$UNIT"
rm -f "$TMP_UNIT"

$SUDO systemctl daemon-reload
$SUDO systemctl enable --now "$SERVICE"
sleep 3
$SUDO systemctl --no-pager --lines=5 status "$SERVICE" || true

log "完成。健康检查： curl -fsS http://127.0.0.1:3000/health | python3 -m json.tool"
log "MCP 端点： http://127.0.0.1:3000/mcp （Authorization: Bearer <${ENV_FILE} 里的 token>）"
