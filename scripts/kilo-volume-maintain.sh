#!/bin/sh
set -e

export HOME="${HOME:-/data}"
WARN_PCT="${KILO_VOLUME_WARN_THRESHOLD_PCT:-85}"
NODE_MODULES_MAX_AGE_DAYS="${KILO_NODE_MODULES_MAX_AGE_DAYS:-14}"

mkdir -p /data/logs

echo "[kilo-volume-maintain] $(date -u +%Y-%m-%dT%H:%M:%SZ)"

if command -v df >/dev/null 2>&1; then
  usage="$(df -P /data 2>/dev/null | awk 'NR==2 {gsub(/%/,"",$5); print $5}')"
  echo "[kilo-volume-maintain] /data usage=${usage:-unknown}%"
  if [ -n "${usage}" ] && [ "${usage}" -ge "${WARN_PCT}" ]; then
    echo "[kilo-volume-maintain] WARNING: usage >= ${WARN_PCT}%; aggressive prune"
    find /data -type d -name node_modules -prune -print -exec rm -rf {} + 2>/dev/null || true
    rm -rf /data/.npm-cache/* 2>/dev/null || true
  fi
fi

# Age out stale node_modules under workspace
if [ -d /data/workspace ]; then
  find /data/workspace -type d -name node_modules -mtime "+${NODE_MODULES_MAX_AGE_DAYS}" -prune -print \
    -exec rm -rf {} + 2>/dev/null || true
fi

# Trim npm cache if present
if [ -d /data/.npm-cache ]; then
  find /data/.npm-cache -type f -mtime +30 -delete 2>/dev/null || true
fi

echo "[kilo-volume-maintain] Done"
