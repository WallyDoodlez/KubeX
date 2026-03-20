# Stage 1 — build
FROM node:20-alpine AS builder

WORKDIR /app

COPY package.json ./
RUN npm install

COPY . .

# Pass Docker-Compose service hostnames as build-time env vars
ARG VITE_GATEWAY_URL=http://gateway:8080
ARG VITE_REGISTRY_URL=http://kubex-registry:8070
ARG VITE_MANAGER_URL=http://kubex-manager:8090
ARG VITE_MANAGER_TOKEN=changeme-manager-token

ENV VITE_GATEWAY_URL=$VITE_GATEWAY_URL
ENV VITE_REGISTRY_URL=$VITE_REGISTRY_URL
ENV VITE_MANAGER_URL=$VITE_MANAGER_URL
ENV VITE_MANAGER_TOKEN=$VITE_MANAGER_TOKEN

RUN npm run build

# Stage 2 — serve
FROM nginx:alpine

COPY --from=builder /app/dist /usr/share/nginx/html

# nginx config that sends all SPA routes to index.html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 3000

CMD ["nginx", "-g", "daemon off;"]
