# agent-search-stack

**English** · [简体中文](README.zh-CN.md)

A self-hosted **search + web-fetch** stack: multi-source retrieval straight from official APIs, a keyless fetch-fallback ring, a local content-extraction floor, a SearXNG metasearch backend, and a thin gateway that exposes all of it as MCP tools.

> Designed for small servers (≈4 GB RAM) and small-memory agent runtimes: fully self-hosted, no hard dependencies, no mandatory signup.

---

## The problems it solves

1. **On datacenter IPs, public search-engine adapters fail en masse** — CAPTCHAs, 403/429, and silent zero-result responses. Measured: SearXNG's `wikipedia` / `wikidata` / `mojeek` / `360search` returned nothing, `duckduckgo` / `qwant` / `baidu` were CAPTCHA-walled, `google` / `brave` returned 403/429 — while **the official APIs of the very same sites answered 200 in 0.3–1.1 s**. So: resolve the site first, hit its API directly. Faster, more accurate, more stable than going through a metasearch layer.
2. **The fetch path must work without API keys** — the keyless remote tiers (Exa / Parallel / Firecrawl / Keenable) rate-limit. A **local extraction floor** (Trafilatura + curl_cffi) covers that: zero cost, no rate limit, and the queried content never leaves your network.
3. **Fetch capability must be reusable across processes** — the same stack serves both a CLI and any MCP client (Hermes Agent, OpenCode, any MCP host).

---

## Architecture

```
Agent (Hermes / OpenCode / any MCP client)
 ├─ MCP tool source_search ─► vps/mcp_source_search.py ─► vps/source_search.py
 │                                                          └─► Wikipedia / HN (Algolia) / arXiv
 │                                                              StackExchange / GitHub / Crossref / DDG
 │                                                              (each via its own official API, with abstracts)
 ├─ Web search ────────────► SearXNG (:8890)  ─► bing / brave / google / yandex / 360search
 ├─ Article fetch ─────────► keyless fallback ring: Exa → Parallel → Firecrawl → Keenable → local parser
 └─ Unified gateway (MCP over HTTP, :3000) ─► searxng / FlareSolverr / embedded playwright (heavy SPAs)
```

The key rule in the fallback ring: **advance to the next tier only when an entire batch comes back with rate-limit-shaped errors**. Partial failures and page-level 403s are returned as-is and never mistaken for throttling.

---

## Components

| Path | What it is |
|---|---|
| `vps/source_search.py` | Multi-source direct-search CLI: wikip/hn/arxiv/so/github/crossref/ddg, returns abstract-bearing items in 0.4–1.1 s; supports `--json` and `--save` (JSONL archive with URL de-duplication) |
| `vps/mcp_source_search.py` | Stdlib-only MCP stdio server exposing the above as the `source_search` tool |
| `vps/exa_search.py` | Keyless retriever for the public Exa / Parallel MCP endpoints — gets you passage-level evidence with no key |
| `vps/hermes-plugin-web-local-extract/` | Hermes user-level plugin registering a `local_extract` web provider at the tail of the keyless ring (Trafilatura + curl_cffi Chrome TLS fingerprint) |
| `vps/web_backend.sh` | Backend switch: locks the free tier by default, paid tiers are enabled manually (prevents "key present ⇒ silent drift to paid") |
| `vps/mcp_probe.py` | Backend probe: hits the local and remote channels separately, reports item counts and `unresponsive_engines` |
| `gateway/` | Unified search/fetch gateway (TypeScript, MCP over HTTP): search / fetch / browser_* / health; fetch routes smartly direct → FlareSolverr → playwright. Ships with a Dockerfile, docker-compose and a bare-metal installer |
| `searxng/` | SearXNG config example, systemd units (including the daily domain-filter-list rebuild timer), and the matching ops scripts under `searxng/scripts/` (hostnames-list rebuild + detection-based watchdog) |
| `pc/flaresolverr-compat/` | Residential-IP fetch channel for Windows: a self-contained **FlareSolverr-compatible API** (`:8191`) over Playwright with a persistent browser profile, idempotent self-healing launcher, plus collectors for taobao / jd / suning / xiaohongshu / bilibili |
| `skills/` | Operational playbooks distilled from this work, pitfalls and verification methods included |

---

## Quick start

```bash
# 1) Multi-source direct search (standard library only, no install needed)
python3 vps/source_search.py "zero-knowledge proofs explained" --lang en --limit 4
python3 vps/source_search.py "lora fine-tuning vram" --lang en --sources arxiv,github,so,hn
python3 vps/source_search.py "quantum computing" --json | jq          # structured
python3 vps/source_search.py "quantum computing" --save                # append to JSONL archive, de-duped by URL

# 2) Keyless passage-level results (public Exa / Parallel endpoints)
python3 vps/exa_search.py "SearXNG braveapi engine config" 3 exa
python3 vps/exa_search.py "best GPUs 2026" 5 parallel
```

**Register as an MCP tool** (stdio):

```json
{ "mcpServers": { "source_search": { "command": "python3", "args": ["/abs/path/vps/mcp_source_search.py"] } } }
```

**Install the local-extraction plugin** (Hermes):

```bash
mkdir -p "${HERMES_HOME:-~/.hermes}/plugins"
cp -a vps/hermes-plugin-web-local-extract "${HERMES_HOME:-~/.hermes}/plugins/"
hermes plugins enable web-local-extract --no-allow-tool-override
# Dependencies (install into the Hermes venv):
#   pip install trafilatura lxml_html_clean curl_cffi
```

**Gateway** — one command with Docker:

```bash
cd gateway && ./scripts/docker-up.sh      # builds, starts gateway + SearXNG + FlareSolverr, waits for /health
```

Bare-metal alternative: `gateway/scripts/install-native.sh` (installs a systemd unit). Details in `gateway/docs/docker.md` and `gateway/README.md`. **SearXNG**: start from `searxng/settings.yml.example` and replace `secret_key` with the output of `openssl rand -hex 32`.

---

## Design notes (all measured, not guessed)

- **Direct API > metasearch**: technical / academic / factual queries go to official APIs — authoritative items, an order of magnitude lower latency. Breaking news and community sentiment still go to metasearch.
- **The fallback ring only advances on batch-wide rate limiting**: this avoids mistaking a "page 403" for "the provider is throttling me" and degrading for nothing.
- **The local floor never grabs the driver's seat**: `local_extract` sits at the tail of the ring and does not change `extract_backend`, so existing sessions never suddenly fail with `no registered provider`.
- **Tiers are locked explicitly**: once a paid backend's key exists in the environment, auto-detection drifts to it. A switch script pins `searxng` (search) and `exa` (fetch); paid tiers must be enabled by hand.
- **Result-poisoning containment**: SearXNG runs with `safe_search: 2` and a hostnames removal list, rebuilt by a daily timer (the list itself is not committed — see `docs/SECURITY.md`).

---

## Security

- The repository contains **no keys**; every credential is injected through environment variables (`TAVILY_API_KEY` / `BRAVE_SEARCH_API_KEY` / `EXA_API_KEY`, …).
- `.gitignore` excludes `.env`, instance config (`gateway.yaml`), `node_modules/`, build output and the domain-filter list.
- The gateway ships SSRF protection (`gateway/src/fetch/ssrf.ts`) and an optional bearer token; bind it to `127.0.0.1` unless you put real auth in front of it.
- See `docs/SECURITY.md`.

## License

MIT — see `LICENSE`. Third-party dependency licenses: `gateway/THIRD_PARTY_LICENSES.md`.
