FROM node:alpine

ARG VERSION=unknown
LABEL org.opencontainers.image.version=$VERSION

ENV APP_VERSION=$VERSION

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY src/ ./src/

EXPOSE 8000

CMD ["node", "src/server.js"]
