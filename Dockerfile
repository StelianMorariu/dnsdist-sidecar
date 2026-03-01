FROM node:20-alpine

ARG VERSION=unknown
LABEL org.opencontainers.image.title="dnsdist-sidecar" \
      org.opencontainers.image.description="dnsdist iFrame widget for Homepage" \
      org.opencontainers.image.url="https://github.com/StelianMorariu/dnsdist-sidecar" \
      org.opencontainers.image.source="https://github.com/StelianMorariu/dnsdist-sidecar" \
      org.opencontainers.image.version=$VERSION

ENV APP_VERSION=$VERSION
ENV NODE_ENV=production

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY config.json ./
COPY src/ ./src/

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8000/health || exit 1

CMD ["node", "src/server.js"]
