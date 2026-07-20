#!/bin/sh
# Entrypoint for the Kilo Telegram bot service.
# Boots the bot in long-poll mode (no public domain required).
set -e

export KILO_TELEGRAM_HOME="${KILO_TELEGRAM_HOME:-/data}"

# Make sure the state directory exists on the persistent volume.
mkdir -p "${KILO_TELEGRAM_HOME}/kilo-telegram"

echo "[entrypoint] Kilo Telegram bot starting"
echo "[entrypoint] KILO_TELEGRAM_HOME=${KILO_TELEGRAM_HOME}"
echo "[entrypoint] KILO_SERVER_URL=${KILO_SERVER_URL}"

# Optional: force IPv4 for Telegram long-poll if the host has flaky IPv6.
if [ -n "${TELEGRAM_FORCE_IPV4}" ]; then
  export NODE_OPTIONS="${NODE_OPTIONS} --dns-result-order=ipv4first"
fi

exec node /app/bot.js
