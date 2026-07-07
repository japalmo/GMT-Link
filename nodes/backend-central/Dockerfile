# Dockerfile del servicio API (NestJS) — build desde la raíz del monorepo pnpm.
# En Railway: setear RAILWAY_DOCKERFILE_PATH=nodes/backend-central/Dockerfile (root dir = raíz del repo).
FROM node:22-slim

# Prisma necesita openssl; ca-certificates para llamadas TLS salientes (Firebase/NVIDIA).
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

RUN npm install -g pnpm@9

WORKDIR /app

# Copia todo el workspace (el .dockerignore excluye node_modules/dist/.git/.env).
COPY . .

# Instala dependencias de todo el workspace.
RUN pnpm install

# shared-types se consume compilado (main: dist/index.js) -> hay que construirlo.
RUN pnpm --filter @gmt-platform/contracts build

# Cliente Prisma + build de la API.
RUN pnpm --filter @gmt-platform/backend-central exec prisma generate
RUN pnpm --filter @gmt-platform/backend-central build

ENV NODE_ENV=production
WORKDIR /app/nodes/backend-central

# Release + arranque: migraciones + seed idempotente del catálogo de permisos/roles/
# departamentos (para que cambios de permisos lleguen a prod) + levanta. El seed es
# no-fatal (no debe tumbar el arranque si algo falla). PORT lo inyecta Railway.
CMD ["sh", "-c", "pnpm exec prisma migrate deploy && (pnpm exec prisma db seed || echo 'db seed failed, continuing') && node dist/main.js"]
