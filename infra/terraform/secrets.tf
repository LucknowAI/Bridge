# ==============================================================
# Secrets Manager. ECS injects these into containers as environment
# variables at start-up, so no secret is ever baked into an image
# or written into a task definition in plaintext.
# ==============================================================

# Encrypts the session cookie. Generated here so it never has to be handled by a
# human. Two slots make rotation free of sign-outs: the active slot seals new
# cookies, the other is still accepted for reading (SESSION_SECRET_PREVIOUS).
# To rotate, regenerate the inactive slot and make it active in one apply:
#   terraform apply -replace=random_password.session_secret_b -var session_secret_active=b
# (next time: -replace=random_password.session_secret -var session_secret_active=a)
resource "random_password" "session_secret" {
  length  = 64
  special = false
}

resource "random_password" "session_secret_b" {
  length  = 64
  special = false
}

# Hashes login codes; separate from the session secret so rotating that one
# leaves codes already e-mailed valid.
resource "random_password" "otp_pepper" {
  length  = 64
  special = false
}

resource "random_password" "keycloak_client_secret" {
  length  = 48
  special = false
}

resource "random_password" "keycloak_admin_password" {
  length           = 32
  special          = true
  override_special = "!#$%&*()-_=+"
}

# Three secrets, so each task reads only its own credentials:
#   app       web and worker (runtime database login, no master password)
#   identity  Keycloak (its own database login and admin bootstrap)
#   migrate   the migration task (master login plus the passwords it sets)
locals {
  secret_values = {
    DATABASE_URL             = local.app_database_url
    SESSION_SECRET           = var.session_secret_active == "a" ? random_password.session_secret.result : random_password.session_secret_b.result
    SESSION_SECRET_PREVIOUS  = var.session_secret_active == "a" ? random_password.session_secret_b.result : random_password.session_secret.result
    OTP_PEPPER               = random_password.otp_pepper.result
    KEYCLOAK_CLIENT_SECRET   = random_password.keycloak_client_secret.result
    GEMINI_API_KEY           = var.gemini_api_key
    UPSTASH_REDIS_REST_URL   = var.upstash_redis_rest_url
    UPSTASH_REDIS_REST_TOKEN = var.upstash_redis_rest_token
    RESEND_API_KEY           = var.resend_api_key
    GOOGLE_CLIENT_ID         = var.google_client_id
  }

  identity_secret_values = {
    KEYCLOAK_ADMIN_PASSWORD = random_password.keycloak_admin_password.result
    KEYCLOAK_DB_PASSWORD    = random_password.db_keycloak.result
    KEYCLOAK_CLIENT_SECRET  = random_password.keycloak_client_secret.result
    GOOGLE_CLIENT_ID        = var.google_client_id
    GOOGLE_CLIENT_SECRET    = var.google_client_secret
  }

  migrate_secret_values = {
    DATABASE_ADMIN_URL        = local.admin_database_url
    DATABASE_RUNTIME_PASSWORD = random_password.db_runtime.result
    KEYCLOAK_DB_PASSWORD      = random_password.db_keycloak.result
  }
}

resource "aws_secretsmanager_secret" "app" {
  name        = "${local.name}/app"
  description = "Runtime secrets for the Mr. Bridge web and worker services."

  # Zero means immediate deletion, which keeps `terraform destroy` from leaving
  # a name reserved for 30 days and blocking a re-apply.
  recovery_window_in_days = 0
}

resource "aws_secretsmanager_secret_version" "app" {
  secret_id     = aws_secretsmanager_secret.app.id
  secret_string = jsonencode(local.secret_values)
}

resource "aws_secretsmanager_secret" "identity" {
  name                    = "${local.name}/identity"
  description             = "Keycloak's database login, admin bootstrap and identity-provider secrets."
  recovery_window_in_days = 0
}

resource "aws_secretsmanager_secret_version" "identity" {
  secret_id     = aws_secretsmanager_secret.identity.id
  secret_string = jsonencode(local.identity_secret_values)
}

resource "aws_secretsmanager_secret" "migrate" {
  name                    = "${local.name}/migrate"
  description             = "Database master login, used only by the migration task."
  recovery_window_in_days = 0
}

resource "aws_secretsmanager_secret_version" "migrate" {
  secret_id     = aws_secretsmanager_secret.migrate.id
  secret_string = jsonencode(local.migrate_secret_values)
}

# Individual keys, referenced one by one from the task definitions so each
# container receives only the values it actually needs.
locals {
  secret_ref          = { for key in keys(local.secret_values) : key => "${aws_secretsmanager_secret.app.arn}:${key}::" }
  identity_secret_ref = { for key in keys(local.identity_secret_values) : key => "${aws_secretsmanager_secret.identity.arn}:${key}::" }
  migrate_secret_ref  = { for key in keys(local.migrate_secret_values) : key => "${aws_secretsmanager_secret.migrate.arn}:${key}::" }
}
