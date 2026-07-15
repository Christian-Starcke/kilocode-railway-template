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
MCP_WARM_STATE_FILE="/data/logs/.mcp-warm-state"

# Write Kilo config if provided
if [ -n "${KILO_CONFIG_CONTENT:-}" ]; then
  printf '%s\n' "${KILO_CONFIG_CONTENT}" > "${CONFIG_PATH}"
  echo "[kilo-mcp-bootstrap] Wrote ${CONFIG_PATH}"
else
  echo "[kilo-mcp-bootstrap] KILO_CONFIG_CONTENT unset; skipping config write"
fi

# Install Railway CLI if not present
if ! command -v railway >/dev/null 2>&1; then
  echo "[kilo-mcp-bootstrap] Installing @railway/cli into /data/.npm-global"
  npm install -g --prefix /data/.npm-global @railway/cli >/data/logs/railway-cli-install.log 2>&1 || \
    echo "[kilo-mcp-bootstrap] WARNING: Railway CLI install failed" >&2
fi

# Check if we should skip MCP warming (deployment ID caching)
DEPLOYMENT_ID="${RAILWAY_DEPLOYMENT_ID:-unknown}"
SHOULD_WARM=true

if [ -f "${MCP_WARM_STATE_FILE}" ]; then
  CACHED_DEPLOYMENT_ID=$(cat "${MCP_WARM_STATE_FILE}")
  if [ "${CACHED_DEPLOYMENT_ID}" = "${DEPLOYMENT_ID}" ]; then
    echo "[kilo-mcp-bootstrap] Already warmed for deployment ${DEPLOYMENT_ID}; skipping MCP packages"
    SHOULD_WARM=false
  else
    echo "[kilo-mcp-bootstrap] Deployment changed (${CACHED_DEPLOYMENT_ID} → ${DEPLOYMENT_ID}); re-warming MCP packages"
  fi
else
  echo "[kilo-mcp-bootstrap] First deployment (${DEPLOYMENT_ID}); warming MCP packages"
fi

# Warm common MCP packages
if $SHOULD_WARM; then
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

  # Record deployment ID so we can skip warming on next restart (if no deploy)
  mkdir -p "$(dirname "${MCP_WARM_STATE_FILE}")"
  printf '%s' "${DEPLOYMENT_ID}" > "${MCP_WARM_STATE_FILE}"
  echo "[kilo-mcp-bootstrap] Saved deployment state: ${DEPLOYMENT_ID}"
fi

echo "[kilo-mcp-bootstrap] Done"
