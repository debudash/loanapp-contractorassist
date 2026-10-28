FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
# Source and tests are mounted by docker compose, so edits need no rebuild.
COPY tsconfig.json ./
