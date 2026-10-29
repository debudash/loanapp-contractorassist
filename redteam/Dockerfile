# Promptfoo needs Node 22.22 or later; the assistant service stays on its own image.
FROM node:22.22.3-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY provider.mjs promptfooconfig.yaml run.sh summarise.mjs ./
ENTRYPOINT ["npx", "promptfoo"]
