FROM node:22-alpine

WORKDIR /workspace

RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json eslint.config.mjs ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/shared-types/package.json packages/shared-types/package.json

RUN pnpm install --frozen-lockfile

COPY . .

RUN pnpm --filter @gmt-platform/contracts build && cd apps/api && pnpm exec prisma generate

EXPOSE 3001 5173

CMD ["sh", "-c", "pnpm dev"]