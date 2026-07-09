# kilocode-railway-template

Thin Railway deploy for [Kilo Code CLI](https://kilo.ai/) (`kilo serve`).

- Public UI: **`/console`**
- Auth: HTTP Basic (`KILO_SERVER_USERNAME` default `kilo` + `KILO_SERVER_PASSWORD`)
- Persistence: volume at **`/data`** (`HOME=/data`)

## Required variables

| Variable | Purpose |
|----------|---------|
| `KILO_SERVER_PASSWORD` | Basic Auth password (required) |
| `KILO_CONFIG_CONTENT` | Trusted `kilo.json` (MCP + model); synced from connections-hub |
| `KILO_VERSION` | npm `@kilocode/cli` version baked into the image (Dockerfile `ARG`) |

Also set by connections-hub sync: provider API keys, `SEARXNG_URL`, `HOME=/data`, `KILO_NO_DAEMON=true`, `NPM_CONFIG_CACHE`, `PREPEND_PATH`.

## Volume layout

| Path | Purpose |
|------|---------|
| `/data/.config/kilo/` | Materialized `kilo.json` |
| `/data/.local/share/kilo/` | `kilo.db`, auth, MCP OAuth |
| `/data/workspace` | Scratch working tree |
| `/data/.npm-global` / `/data/.npm-cache` | Railway CLI + npx MCP cache |

## Healthcheck

With a password set, `GET /global/health` requires Basic Auth:

```bash
curl -u "kilo:$KILO_SERVER_PASSWORD" "https://<domain>/global/health"
```

## Local image build

```bash
docker build --build-arg KILO_VERSION=7.4.1 -t kilo-railway .
```
