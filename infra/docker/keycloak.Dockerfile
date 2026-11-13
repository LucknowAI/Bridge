# syntax=docker/dockerfile:1.7
# ==============================================================
# Keycloak with the Mr. Bridge realm baked in.
#
# The two-stage build runs `kc.sh build` ahead of time so the runtime container
# starts with --optimized: no augmentation step, so a cold ECS task reaches
# healthy in a fraction of the time.
#
# Build from the monorepo root:
#   docker build -f infra/docker/keycloak.Dockerfile .
# ==============================================================

FROM quay.io/keycloak/keycloak:26.0 AS builder

# Baked into the optimized image, so these cannot change at runtime.
ENV KC_DB=postgres
ENV KC_HEALTH_ENABLED=true
ENV KC_METRICS_ENABLED=true

RUN /opt/keycloak/bin/kc.sh build

FROM quay.io/keycloak/keycloak:26.0

COPY --from=builder /opt/keycloak/ /opt/keycloak/

# Amazon's RDS CA bundle, referenced by KC_DB_URL (sslmode=verify-full).
ADD --chmod=644 https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem /opt/keycloak/conf/rds-global-bundle.pem

# Imported on first boot. Placeholders inside are filled from the task's
# environment (client secret, app URL, Google credentials).
COPY keycloak/realm-export.json /opt/keycloak/data/import/realm-export.json

# Site-styled login theme; selected per realm by `npm run keycloak:sync`.
COPY keycloak/themes/mr-bridge /opt/keycloak/themes/mr-bridge

ENTRYPOINT ["/opt/keycloak/bin/kc.sh"]
CMD ["start", "--optimized", "--import-realm"]
