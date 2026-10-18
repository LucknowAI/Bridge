# ==============================================================
# RDS Postgres. One instance holds two databases:
#   <project>  — application data
#   keycloak   — Keycloak's own store, created by the migration task
# ==============================================================

resource "aws_db_subnet_group" "main" {
  name       = "${local.name}-db-subnet-group"
  subnet_ids = aws_subnet.private[*].id

  tags = { Name = "${local.name}-db-subnet-group" }
}

resource "random_password" "db" {
  length = 32
  # RDS rejects '/', '@', '"' and space in master passwords, and the value ends
  # up in a URL, so restrict to characters that survive both.
  special          = true
  override_special = "!#$%&*()-_=+[]{}<>:?"
}

# Least-privilege logins, created by the migration task (ensure-roles.ts). The
# master login above is used only to run migrations.
resource "random_password" "db_runtime" {
  length  = 40
  special = false
}

resource "random_password" "db_keycloak" {
  length  = 40
  special = false
}

resource "aws_db_parameter_group" "main" {
  name   = "${local.name}-pg16"
  family = "postgres16"

  parameter {
    name  = "log_min_duration_statement"
    value = "1000" # log anything slower than a second
  }

  # Postgres defaults to allowing unencrypted connections; this forces TLS.
  parameter {
    name  = "rds.force_ssl"
    value = "1"
  }

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_db_instance" "main" {
  identifier     = "${local.name}-postgres"
  engine         = "postgres"
  engine_version = "16.4"
  instance_class = var.db_instance_class

  allocated_storage     = var.db_allocated_storage
  max_allocated_storage = var.db_max_allocated_storage
  storage_type          = "gp3"
  storage_encrypted     = true

  db_name  = replace(var.project_name, "-", "_")
  username = "app_admin"
  password = random_password.db.result
  port     = 5432

  db_subnet_group_name   = aws_db_subnet_group.main.name
  vpc_security_group_ids = [aws_security_group.rds.id]
  parameter_group_name   = aws_db_parameter_group.main.name
  publicly_accessible    = false

  multi_az                = var.db_multi_az
  backup_retention_period = var.db_backup_retention_days
  backup_window           = "18:00-19:00" # off-peak for IST
  maintenance_window      = "sun:19:30-sun:20:30"
  copy_tags_to_snapshot   = true

  auto_minor_version_upgrade = true
  deletion_protection        = var.db_deletion_protection
  skip_final_snapshot        = false
  final_snapshot_identifier  = "${local.name}-final-${formatdate("YYYYMMDDhhmmss", timestamp())}"

  performance_insights_enabled    = true
  enabled_cloudwatch_logs_exports = ["postgresql", "upgrade"]

  tags = { Name = "${local.name}-postgres" }

  lifecycle {
    # The snapshot identifier embeds a timestamp, which would otherwise show a
    # diff on every plan.
    ignore_changes = [final_snapshot_identifier]
  }
}

locals {
  db_password_encoded = urlencode(random_password.db.result)

  db_runtime_user  = "app_runtime"
  db_keycloak_user = "keycloak"

  # Migrations only.
  admin_database_url = format(
    "postgres://%s:%s@%s:%s/%s",
    aws_db_instance.main.username,
    local.db_password_encoded,
    aws_db_instance.main.address,
    aws_db_instance.main.port,
    aws_db_instance.main.db_name,
  )

  # Web and worker: row access only.
  app_database_url = format(
    "postgres://%s:%s@%s:%s/%s",
    local.db_runtime_user,
    random_password.db_runtime.result,
    aws_db_instance.main.address,
    aws_db_instance.main.port,
    aws_db_instance.main.db_name,
  )

  # verify-full checks the RDS certificate with the bundle baked into the image.
  keycloak_jdbc_url = format(
    "jdbc:postgresql://%s:%s/keycloak?sslmode=verify-full&sslrootcert=/opt/keycloak/conf/rds-global-bundle.pem",
    aws_db_instance.main.address,
    aws_db_instance.main.port,
  )

  # Path of the RDS CA bundle inside the web, worker and migrate images.
  database_ca_file = "/etc/ssl/certs/rds-global-bundle.pem"
}
