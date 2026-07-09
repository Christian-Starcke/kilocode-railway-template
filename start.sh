#!/bin/sh
set -e

export HOME=/data
export KILO_NO_DAEMON="${KILO_NO_DAEMON:-true}"
export NPM_CONFIG_CACHE="${NPM_CONFIG_CACHE:-/data/.npm-cache}"
export PATH="${PREPEND_PATH:-/data/.npm-global/bin}:${PATH}"

if [ -z "${KILO_SERVER_PASSWORD:-}" ]; then
  echo "ERROR: KILO_SERVER_PASSWORD is required" >&2
  exit 1
fi

mkdir -p \
  /data/workspace \
  /data/.config/kilo \
  /data/.local/share/kilo \
  /data/.local/state/kilo \
  /data/.npm-global \
  /data/.npm-cache \
  /data/logs

cd /data/workspace

if [ -n "${KILO_BOOTSTRAP_RAW_URL:-}" ] && command -v curl >/dev/null 2>&1; then
  echo "[kilo] Running remote bootstrap: ${KILO_BOOTSTRAP_RAW_URL}"
  curl -fsSL "${KILO_BOOTSTRAP_RAW_URL}" | bash >> /data/logs/bootstrap.log 2>&1 || \
    echo "[kilo] WARNING: remote bootstrap failed; continuing" >&2
elif [ -x /app/scripts/workspace-bootstrap.sh ]; then
  echo "[kilo] Running local workspace-bootstrap.sh"
  /app/scripts/workspace-bootstrap.sh >> /data/logs/bootstrap.log 2>&1 || \
    echo "[kilo] WARNING: local bootstrap failed; continuing" >&2
fi

echo "[kilo] Starting kilo serve on 0.0.0.0:${PORT:-8080} (version=${KILO_VERSION:-unknown})"
exec kilo serve --hostname 0.0.0.0 --port "${PORT:-8080}"
