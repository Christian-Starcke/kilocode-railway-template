#!/bin/sh
set -e

export HOME="${HOME:-/data}"
export NPM_CONFIG_CACHE="${NPM_CONFIG_CACHE:-/data/.npm-cache}"
export PATH="${PREPEND_PATH:-/data/.npm-global/bin}:${PATH}"

mkdir -p \
  /data/.config/kilo \
  /data/.npm-global \
  /data/.npm-cache \
  /data/logs

CONFIG_PATH="/data/.config/kilo/kilo.json"

if [ -n "${KILO_CONFIG_CONTENT:-}" ]; then
  printf '%s\n' "${KILO_CONFIG_CONTENT}" > "${CONFIG_PATH}"
  echo "[kilo-mcp-bootstrap] Wrote ${CONFIG_PATH}"
else
  echo "[kilo-mcp-bootstrap] KILO_CONFIG_CONTENT unset; skipping config write"
fi

if ! command -v railway >/dev/null 2>&1; then
  echo "[kilo-mcp-bootstrap] Installing @railway/cli into /data/.npm-global"
  npm install -g --prefix /data/.npm-global @railway/cli >/data/logs/railway-cli-install.log 2>&1 || \
    echo "[kilo-mcp-bootstrap] WARNING: Railway CLI install failed" >&2
fi

# Warm common MCP packages used by connections-hub kilo.json template
warm() {
  pkg="$1"
  echo "[kilo-mcp-bootstrap] Warming ${pkg}"
  npx -y "${pkg}" --help >/dev/null 2>&1 || true
}

warm "@modelcontextprotocol/server-github"
warm "firecrawl-mcp"
warm "mcp-searxng"
warm "@abhaybabbar/retellai-mcp-server"
warm "@supabase/mcp-server-supabase@latest"
warm "resend-mcp"
warm "@n8n-as-code/mcp"
warm "@sentry/mcp-server@latest"

echo "[kilo-mcp-bootstrap] Done"
