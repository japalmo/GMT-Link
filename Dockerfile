FROM node:22-alpine

WORKDIR /workspace

RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json eslint.config.mjs ./
COPY nodes/backend-central/package.json nodes/backend-central/package.json
COPY nodes/web/package.json nodes/web/package.json
COPY packages/contracts/package.json packages/contracts/package.json

RUN pnpm install --frozen-lockfile

COPY . .

RUN pnpm --filter @gmt-platform/contracts build && cd nodes/backend-central && pnpm exec prisma generate

EXPOSE 3001 5173

CMD ["sh", "-c", "pnpm dev"]