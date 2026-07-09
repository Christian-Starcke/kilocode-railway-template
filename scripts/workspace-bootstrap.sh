#!/bin/sh
set -e

export HOME="${HOME:-/data}"
SCRIPT_DIR="$(CDPATH= cd -- "$(dirname "$0")" && pwd)"

mkdir -p /data/logs

echo "[workspace-bootstrap] start $(date -u +%Y-%m-%dT%H:%M:%SZ)"

if [ -x "${SCRIPT_DIR}/kilo-volume-maintain.sh" ]; then
  "${SCRIPT_DIR}/kilo-volume-maintain.sh" >> /data/logs/volume-maintain.log 2>&1 || true
fi

if [ -x "${SCRIPT_DIR}/kilo-mcp-bootstrap.sh" ]; then
  "${SCRIPT_DIR}/kilo-mcp-bootstrap.sh" >> /data/logs/mcp-bootstrap.log 2>&1 || true
elif [ -n "${KILO_SCRIPT_RAW_BASE:-}" ] && command -v curl >/dev/null 2>&1; then
  curl -fsSL "${KILO_SCRIPT_RAW_BASE}/kilo-mcp-bootstrap.sh" | bash >> /data/logs/mcp-bootstrap.log 2>&1 || true
fi

# Optional repo clone/pull — off by default (scratch workspace)
if [ "${WORKSPACE_BOOTSTRAP:-false}" = "true" ]; then
  echo "[workspace-bootstrap] WORKSPACE_BOOTSTRAP=true but auto-clone is not implemented in v1"
fi

echo "[workspace-bootstrap] done"
