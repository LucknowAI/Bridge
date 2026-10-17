# Runs the async profile embedding and matching queue processors.
FROM node:22-alpine
WORKDIR /repo

COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/
COPY packages/db/package.json packages/db/
COPY packages/auth/package.json packages/auth/
COPY packages/email/package.json packages/email/

RUN --mount=type=cache,target=/root/.npm npm ci --include=dev

COPY apps/web/src apps/web/src
COPY packages/db packages/db
COPY packages/auth packages/auth
COPY packages/email packages/email

ENV NODE_ENV=production
CMD ["npx", "tsx", "packages/db/workers/worker.ts"]
