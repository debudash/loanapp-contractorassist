FROM node:22.20.0-alpine AS dev
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
# Source and tests are mounted by docker compose, so edits need no rebuild.
COPY tsconfig.json ./

FROM dev AS build
COPY tsconfig.build.json ./
COPY src ./src
RUN npx tsc -p tsconfig.build.json

FROM node:22.20.0-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
RUN mkdir -p /app/data && chown node:node /app/data
USER node
EXPOSE 4100
HEALTHCHECK CMD wget -qO- http://localhost:4100/health || exit 1
# node:sqlite is still marked experimental in Node 22; silence the warning.
CMD ["node", "--disable-warning=ExperimentalWarning", "dist/server.js"]
