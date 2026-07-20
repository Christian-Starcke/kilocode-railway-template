FROM node:22-bookworm-slim

ARG KILO_VERSION=7.4.11
ENV KILO_VERSION=${KILO_VERSION}
ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    bash \
    ca-certificates \
    curl \
    git \
  && rm -rf /var/lib/apt/lists/*

# Pin the Kilo CLI so the bot's attach/run contract stays stable.
RUN npm install -g "@kilocode/cli@${KILO_VERSION}" \
  && kilo --version

WORKDIR /app

COPY package.json /app/package.json
RUN npm install --omit=dev

COPY bot.js /app/bot.js
COPY kilo-runner.js /app/kilo-runner.js
COPY state-store.js /app/state-store.js
COPY entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

# The bot keeps only routing/session state here; Kilo owns the real sessions.
ENV KILO_TELEGRAM_HOME=/data

CMD ["/bin/sh", "/app/entrypoint.sh"]
