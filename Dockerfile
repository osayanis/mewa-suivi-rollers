# Image unique : interface web + API. Construction : docker compose build

# ---- 1. Construction de l'interface web ----
FROM node:24-alpine AS ui
WORKDIR /ui
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-fund --no-audit
COPY frontend/ ./
RUN npm run build

# ---- 2. Serveur ----
FROM node:24-alpine

ENV NODE_ENV=production \
    TZ=Europe/Paris \
    PORT=8080 \
    DB_PATH=/data/rollers.db \
    PUBLIC_DIR=/app/public

WORKDIR /app
COPY backend/package.json backend/package-lock.json ./
RUN npm ci --omit=dev --no-fund --no-audit && npm cache clean --force
COPY backend/src ./src
COPY --from=ui /ui/dist ./public

RUN mkdir -p /data && chown node:node /data
USER node
VOLUME ["/data"]
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/api/health || exit 1

CMD ["node", "--disable-warning=ExperimentalWarning", "src/server.js"]
