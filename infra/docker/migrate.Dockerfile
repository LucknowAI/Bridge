# syntax=docker/dockerfile:1.7
# Migration/seed runner. Small image whose only job is to bring the schema up to
# date, then exit — used by docker-compose locally and as a one-off ECS task in
# the deploy pipeline.
FROM node:22-alpine
WORKDIR /repo

COPY package.json package-lock.json ./
COPY apps/web/package.json      apps/web/
COPY packages/db/package.json   packages/db/
COPY packages/auth/package.json packages/auth/
COPY packages/email/package.json packages/email/

# tsx runs the TypeScript migration runner directly — no build step for a task
# that executes a handful of times per deploy.
RUN --mount=type=cache,target=/root/.npm \
    npm ci --include=dev --ignore-scripts

COPY packages/db  packages/db
COPY tools        tools

# Seeding is opt-in: it must run on a fresh local stack, never against prod data.
CMD ["sh", "-c", "npx tsx packages/db/src/migrate.ts && if [ \"$SEED_ON_MIGRATE\" = \"true\" ]; then npx tsx packages/db/src/seed.ts; fi"]
