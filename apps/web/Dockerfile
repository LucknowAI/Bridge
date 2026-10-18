# syntax=docker/dockerfile:1.7
# ==============================================================
# Mr. Bridge web — multi-stage build for ECS Fargate.
# Build context is the MONOREPO ROOT, not apps/web:
#   docker build -f apps/web/Dockerfile .
# ==============================================================

ARG NODE_VERSION=22-alpine

# ── deps ──────────────────────────────────────────────────────
# Only manifests are copied here, so this layer is reused across
# source-only changes and npm ci runs from cache.
FROM node:${NODE_VERSION} AS deps
WORKDIR /repo

COPY package.json package-lock.json ./
COPY apps/web/package.json           apps/web/
COPY packages/db/package.json        packages/db/
COPY packages/auth/package.json      packages/auth/
COPY packages/email/package.json     packages/email/

RUN --mount=type=cache,target=/root/.npm \
    npm ci --include=dev

# ── builder ───────────────────────────────────────────────────
FROM node:${NODE_VERSION} AS builder
WORKDIR /repo

COPY --from=deps /repo/node_modules ./node_modules
COPY . .

# Next.js inlines NEXT_PUBLIC_* at build time. This app has none — every secret
# is read at runtime — which is why no build-time secrets are needed here.
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production

RUN npm run build --workspace=@match-maker/web

# ── runner ────────────────────────────────────────────────────
FROM node:${NODE_VERSION} AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Run unprivileged. The node image already ships a `node` user (uid 1000).
RUN apk add --no-cache curl

# `output: "standalone"` traced exactly the files the server needs, including
# the workspace packages and their hoisted dependencies. With
# outputFileTracingRoot set to the repo root, the bundle is emitted under
# apps/web/.next/standalone but keeps the monorepo's directory shape inside.
COPY --from=builder --chown=node:node /repo/apps/web/.next/standalone ./
COPY --from=builder --chown=node:node /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder --chown=node:node /repo/apps/web/public ./apps/web/public

# The release tag (commit SHA) the deploy built, reported by /api/health so
# smoke tests and rollbacks can tell which version is serving. Declared late
# so a new tag does not invalidate the cached layers above.
ARG APP_VERSION=dev
ENV APP_VERSION=$APP_VERSION

USER node
EXPOSE 3000

# ECS/ALB health checks hit this. `/api/health` is intentionally dependency-free
# so a database blip doesn't cause the load balancer to kill healthy tasks.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS http://127.0.0.1:3000/api/health || exit 1

CMD ["node", "apps/web/server.js"]
