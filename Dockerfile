FROM node:alpine

ARG VERSION=unknown
LABEL org.opencontainers.image.version=$VERSION

ENV APP_VERSION=$VERSION

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY src/ ./src/

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:8000/health || exit 1

CMD ["node", "src/server.js"]
