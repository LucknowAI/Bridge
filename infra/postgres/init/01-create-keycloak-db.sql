-- Runs once, on first initialisation of the Postgres data volume.
-- Keycloak gets its own database inside the same local container so the dev
-- stack stays to a single Postgres process. In AWS these are separate RDS
-- databases (see infra/terraform).
SELECT 'CREATE DATABASE keycloak'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'keycloak')\gexec
