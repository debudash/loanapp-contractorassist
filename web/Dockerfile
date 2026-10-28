FROM node:22.20.0-alpine AS dev
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json vite.config.ts index.html ./

FROM dev AS build
COPY src ./src
RUN npm run build

# Static files behind nginx, which also proxies /api to the assistant service.
FROM nginx:1.27-alpine AS runtime
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
