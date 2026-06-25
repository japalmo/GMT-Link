# Dockerfile del servicio Web (Vite -> estático servido con `serve`).
# En Railway: RAILWAY_DOCKERFILE_PATH=apps/web/Dockerfile (root dir = raíz del repo).
# Las VITE_* se hornean en build: Railway las pasa como build args si hay ARG con su nombre.
FROM node:22-slim AS build
RUN npm install -g pnpm@9
WORKDIR /app
COPY . .
RUN pnpm install

ARG VITE_API_URL=""
ARG VITE_FIREBASE_API_KEY=""
ARG VITE_FIREBASE_AUTH_DOMAIN=""
ARG VITE_FIREBASE_PROJECT_ID=""
ARG VITE_FIREBASE_AUTH_EMULATOR=""
ENV VITE_API_URL=$VITE_API_URL \
    VITE_FIREBASE_API_KEY=$VITE_FIREBASE_API_KEY \
    VITE_FIREBASE_AUTH_DOMAIN=$VITE_FIREBASE_AUTH_DOMAIN \
    VITE_FIREBASE_PROJECT_ID=$VITE_FIREBASE_PROJECT_ID \
    VITE_FIREBASE_AUTH_EMULATOR=$VITE_FIREBASE_AUTH_EMULATOR

RUN pnpm --filter @gmt-link/web build

FROM node:22-slim AS runtime
RUN npm install -g serve@14
WORKDIR /app
COPY --from=build /app/apps/web/dist ./dist
ENV NODE_ENV=production
# SPA estático en el PORT de Railway (-s = fallback a index.html).
CMD ["sh", "-c", "serve -s dist -l ${PORT:-3000}"]
