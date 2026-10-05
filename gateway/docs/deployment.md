# Deployment

Two supported paths. Pick one — they are independent, and both end at the same
MCP endpoint: `http://127.0.0.1:3000/mcp`.

| | Path A — Docker | Path B — Bare metal |
|---|---|---|
| Best for | clean hosts, reproducibility, easy teardown | no Docker, existing SearXNG/FlareSolverr, low disk |
| Brings up | gateway + SearXNG + FlareSolverr | gateway only (you point it at your own backends) |
| Footprint | ~1.2 GB image + ~2 GB runtime RAM | ~450 MB idle RAM |
| Command | `./scripts/docker-up.sh` | `sudo ./scripts/install-native.sh` |

---

## Path A — Docker Compose

### Prerequisites

- Docker Engine 20.10+ with the Compose v2 plugin (`docker compose version`)
- ~3 GB free disk for the first build (the gateway image bundles Chromium)
- `curl` (the script uses it for the readiness probe)

### Run

```bash
cd gateway
./scripts/docker-up.sh
```

The script is idempotent and does four things:

1. creates `.env` with a random `GATEWAY_TOKEN` (mode 600) — skipped if it exists,
2. generates `docker/searxng/settings.yml` from `../searxng/settings.yml.example`
   with a random `secret_key` (mode 600) — skipped if it exists,
3. `docker compose up -d --build`,
4. polls `/health` for up to 2 minutes and prints the backend report.

### Verify

```bash
curl -fsS http://127.0.0.1:3000/health | python3 -m json.tool
```

```json
{
  "gateway":     { "version": "0.1.0", "uptimeSec": 12 },
  "searxng":     { "status": "up",   "latencyMs": 41 },
  "flaresolverr":{ "status": "up",   "latencyMs": 118 }
}
```

`/health` always answers **200**; the body carries each backend's state. A
`down` backend therefore never puts the container into a restart loop — it just
means that route will fail until the backend is up (search falls back to direct
engines if `TAVILY_API_KEY` is set; fetch falls back to `direct`).

### Connect an MCP client

```json
{
  "mcpServers": {
    "search-gateway": {
      "url": "http://127.0.0.1:3000/mcp",
      "type": "http",
      "headers": { "Authorization": "Bearer <GATEWAY_TOKEN from gateway/.env>" }
    }
  }
}
```

### Configuration layers

Three files, each with a single owner. Do not duplicate settings across them.

| File | Owns | Consumed by | Takes effect |
|---|---|---|---|
| `docker-compose.yml` (env / ports / limits) | process wiring, published ports, memory caps | Docker | `docker compose up -d` |
| `docker/gateway.docker.yaml` (→ `/app/gateway.yaml`) | how the gateway *calls* the backends: URLs, timeouts, result counts, caching, ad filtering, browser pool | gateway (Node) | `docker compose restart gateway` |
| `docker/searxng/settings.yml` (→ `/etc/searxng/settings.yml`) | SearXNG's own engine list, safe search, `secret_key` | SearXNG | `docker compose restart searxng` |

Two container-specific values in `gateway.docker.yaml` that differ from the
bare-metal example, both required:

- `gateway.host: 0.0.0.0` — with `127.0.0.1` the port is unreachable from the host.
- backend URLs use compose service names (`http://searxng:8080`,
  `http://flaresolverr:8191`) instead of loopback.

The gateway binds to loopback on the host side (`127.0.0.1:3000:3000`). That is
deliberate: put a reverse proxy with real auth in front of it if you need remote
access. The bearer token is a shared secret, not a user system.

### Data & persistence

| Volume | Path in container | Notes |
|---|---|---|
| `adblock-data` | `/app/data/adblock` | StevenBlack hosts cache. Persist it or every rebuild re-downloads the list. |
| `./docker/searxng` | `/etc/searxng` | Host bind mount, survives rebuilds. Contains your `secret_key` — never commit it. |

Search/fetch caches are in-process and intentionally not persisted.

### Operations

```bash
docker compose ps
docker compose logs -f gateway
docker compose restart gateway          # after editing docker/gateway.docker.yaml
docker compose up -d --build            # after a git pull
docker compose down                     # stop, keep volumes
docker compose down -v                  # stop and drop the adblock cache
```

Skip Chromium in the image if you only need `search` / `fetch` (no `browser_*`
tools and no rendered-SPA fallback):

```bash
docker compose build --build-arg INSTALL_BROWSER=0
```

### Resource footprint

Measured on the reference 4 GB host, all three containers up:

- idle ≈ 700 MB RSS (SearXNG ~150 MB, FlareSolverr ~250 MB, gateway ~300 MB)
- a `browser_navigate` call peaks around 1 GB extra (Chromium cold start)
- the compose file caps gateway and FlareSolverr at 1 GB each;
  `shm_size: 1gb` on FlareSolverr is mandatory — the default 64 MB crashes Chromium

---

## Path B — Bare metal (systemd)

### Prerequisites

- Node.js ≥ 20 (22/24 LTS recommended), npm
- Debian/Ubuntu with systemd
- SearXNG and FlareSolverr already running (or accept degraded routing);
  the SearXNG units in `../../searxng/systemd/` are a starting point

### Run

```bash
cd gateway
sudo ./scripts/install-native.sh
```

It installs dependencies, builds `dist/`, installs Chromium with its system
dependencies, generates `gateway.yaml` plus `/etc/agent-search/gateway.env`
(random `GATEWAY_TOKEN`, mode 600), writes
`/etc/systemd/system/agent-search-gateway.service`, and enables it.

The unit runs as the invoking user (`SUDO_USER`), restarts on failure, and is
capped with `MemoryMax=1536M` so a runaway Chromium cannot take the box down.

```bash
systemctl status agent-search-gateway
journalctl -u agent-search-gateway -f
sudo systemctl disable --now agent-search-gateway     # stop
sudo rm /etc/systemd/system/agent-search-gateway.service && sudo systemctl daemon-reload
```

### Point it at your backends

Edit `gateway/gateway.yaml` (from `gateway.yaml.example`) and restart:

```yaml
gateway:      { host: 127.0.0.1, port: 3000 }   # loopback is correct here
searxng:      { url: http://127.0.0.1:8890 }
flaresolverr: { url: http://127.0.0.1:8191, enabled: true }
```

Keep `fetch.block_private_ips: true`. If your backends sit behind a transparent
proxy that uses `198.18.0.0/15` fake-IPs, the CIDR is already exempted in
`gateway.yaml.example`.

---

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| Build fails on `npm ci` | `package-lock.json` must be committed; it is, so an out-of-date lock means a changed `package.json` — run `npm install` and commit the lock |
| `/health` shows `searxng: down` | Wrong `searxng.url` (bare metal default is `127.0.0.1:8888`, the compose value is `searxng:8080`), or SearXNG is still booting |
| `/health` shows `flaresolverr: down` | First boot downloads Chromium inside that container — allow ~1 minute |
| `search` returns 0 results but `health` is green | SearXNG's engines are CAPTCHA-walled from your IP. Add `TAVILY_API_KEY` for direct fallback, or route searches through `vps/source_search.py` |
| `browser_navigate` timeouts | Chromium missing (`INSTALL_BROWSER=0` build) or the container is memory-capped too low |
| `fetch` returns 403 on an internal URL | SSRF guard. Add the CIDR to `fetch.private_ip_exempt_cidrs` |
| Port 3000 already in use | Change the host-side port in `docker-compose.yml` (`"127.0.0.1:3001:3000"`); the in-container port stays 3000 |

## Security checklist

- [ ] `GATEWAY_TOKEN` set (never leave it empty on a reachable interface)
- [ ] ports bound to `127.0.0.1` (compose default) or behind authenticated reverse proxy
- [ ] `docker/searxng/settings.yml` and `.env` are mode 600 and gitignored
- [ ] `fetch.block_private_ips: true` left on
- [ ] `docker compose` runs as a non-root user in the `docker` group, not as root
