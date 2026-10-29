# The public deployment (Fly.io, fly.toml): one image that runs the assistant service and serves
# the built web app from the same port. Local development uses docker-compose.yml instead, with
# nginx in front of the API.

FROM node:22.20.0-alpine AS web
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/tsconfig.json web/vite.config.ts web/index.html ./
COPY web/src ./src
RUN npm run build

FROM node:22.20.0-alpine AS server
WORKDIR /app
COPY server/package.json server/package-lock.json ./
RUN npm ci
COPY server/tsconfig.json server/tsconfig.build.json ./
COPY server/src ./src
RUN npx tsc -p tsconfig.build.json

FROM node:22.20.0-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production PORT=8080 STATIC_DIR=/app/public DB_PATH=/data/assistant.db
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev
COPY --from=server /app/dist ./dist
COPY --from=web /web/dist ./public
# Runs as root: Fly mounts the audit volume at /data owned by root.
EXPOSE 8080
CMD ["node", "--disable-warning=ExperimentalWarning", "dist/server.js"]
