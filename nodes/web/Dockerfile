# Dockerfile del servicio Web (Vite -> estático servido con `serve`).
# En Railway: RAILWAY_DOCKERFILE_PATH=nodes/web/Dockerfile (root dir = raíz del repo).
# Las VITE_* se hornean en build: Railway las pasa como build args si hay ARG con su nombre.
FROM node:22-slim AS build
RUN npm install -g pnpm@9.15.9
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile

# Compilar los tipos compartidos ANTES del build de web: su `dist/` es gitignored
# (no llega al contexto Docker), y sin él `tsc` no encuentra @gmt-platform/contracts.
RUN pnpm --filter @gmt-platform/contracts build

ARG VITE_API_URL=""
ENV VITE_API_URL=$VITE_API_URL

RUN pnpm --filter @gmt-platform/web build

FROM node:22-slim AS runtime
RUN npm install -g serve@14
WORKDIR /app
COPY --from=build /app/nodes/web/dist ./dist
ENV NODE_ENV=production
# SPA estático en el PORT de Railway (-s = fallback a index.html).
CMD ["sh", "-c", "serve -s dist -l ${PORT:-3000}"]
