# syntax=docker/dockerfile:1.7
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
# Operator tools (account:*, keycloak:sync) run as one-off tasks from this image.
COPY tools tools

# Amazon's RDS CA bundle, so DATABASE_SSL=verify can check the database
# certificate (DATABASE_CA_CERT_FILE points here in the task definitions).
ADD --chmod=644 https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem /etc/ssl/certs/rds-global-bundle.pem

ENV NODE_ENV=production
# Release tag (commit SHA), logged when the worker starts.
ARG APP_VERSION=dev
ENV APP_VERSION=$APP_VERSION
CMD ["npx", "tsx", "packages/db/workers/worker.ts"]
