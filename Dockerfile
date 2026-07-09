FROM node:22-bookworm-slim

ARG KILO_VERSION=7.4.1
ENV KILO_VERSION=${KILO_VERSION}
ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    bash \
    ca-certificates \
    curl \
    git \
    gh \
    ripgrep \
  && rm -rf /var/lib/apt/lists/*

RUN npm install -g "@kilocode/cli@${KILO_VERSION}" \
  && kilo --version

WORKDIR /app

COPY start.sh /app/start.sh
COPY scripts/ /app/scripts/
RUN chmod +x /app/start.sh /app/scripts/*.sh

EXPOSE 8080

CMD ["/bin/sh", "/app/start.sh"]
