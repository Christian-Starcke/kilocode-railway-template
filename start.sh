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

# Bootstrap phase
if [ -n "${KILO_BOOTSTRAP_RAW_URL:-}" ] && command -v curl >/dev/null 2>&1; then
  echo "[kilo] Running remote bootstrap: ${KILO_BOOTSTRAP_RAW_URL}"
  curl -fsSL "${KILO_BOOTSTRAP_RAW_URL}" | bash >> /data/logs/bootstrap.log 2>&1 || \
    echo "[kilo] WARNING: remote bootstrap failed; continuing" >&2
elif [ -x /app/scripts/workspace-bootstrap.sh ]; then
  echo "[kilo] Running local workspace-bootstrap.sh"
  /app/scripts/workspace-bootstrap.sh >> /data/logs/bootstrap.log 2>&1 || \
    echo "[kilo] WARNING: local bootstrap failed; continuing" >&2
fi

# Start internal kilo serve
INTERNAL_PORT=$(( ${PORT:-8080} + 1 ))
KILO_START_TIMEOUT_SEC="${KILO_START_TIMEOUT_SEC:-120}"

echo "[kilo] Starting kilo serve on 127.0.0.1:${INTERNAL_PORT} (version=${KILO_VERSION:-unknown})"
kilo serve --hostname 127.0.0.1 --port "${INTERNAL_PORT}" &
KILO_PID=$!

# Wait for kilo serve to be ready (startup readiness check)
echo "[kilo] Waiting for kilo serve to be ready (timeout: ${KILO_START_TIMEOUT_SEC}s)"
ELAPSED=0
while [ $ELAPSED -lt $KILO_START_TIMEOUT_SEC ]; do
  if command -v curl >/dev/null 2>&1; then
    if curl -s -o /dev/null "http://127.0.0.1:${INTERNAL_PORT}/" 2>/dev/null; then
      echo "[kilo] kilo serve ready after ${ELAPSED}s"
      break
    fi
  else
    # Fallback: try to connect via /dev/tcp if curl is unavailable
    if (exec 3<>/dev/tcp/127.0.0.1/${INTERNAL_PORT} 2>/dev/null); then
      exec 3>&-
      echo "[kilo] kilo serve ready (TCP check) after ${ELAPSED}s"
      break
    fi
  fi
  
  sleep 1
  ELAPSED=$(( ELAPSED + 1 ))
done

if [ $ELAPSED -ge $KILO_START_TIMEOUT_SEC ]; then
  echo "[kilo] WARNING: kilo serve readiness timeout (${KILO_START_TIMEOUT_SEC}s); proceeding anyway" >&2
fi

# Start proxy server
echo "[server] Starting Kilo proxy server on 0.0.0.0:${PORT:-8080} ( / → /console )"
export INTERNAL_PORT
export LOG_LEVEL="${LOG_LEVEL:-INFO}"
export KILO_SERVER_USERNAME="${KILO_SERVER_USERNAME:-kilo}"
export KILO_SERVER_PASSWORD
exec node /app/server.js
