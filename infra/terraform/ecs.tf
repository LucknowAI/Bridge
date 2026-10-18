# ==============================================================
# ECR repositories, ECS cluster, task definitions and services.
# ==============================================================

resource "aws_ecr_repository" "web" {
  name                 = "${local.name}/web"
  image_tag_mutability = "MUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }

  encryption_configuration {
    encryption_type = "AES256"
  }
}

resource "aws_ecr_repository" "keycloak" {
  name                 = "${local.name}/keycloak"
  image_tag_mutability = "MUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }
}

# Separate from the web image: the web runtime is a Next.js standalone bundle
# with no TypeScript loader, so it cannot execute the migration scripts.
resource "aws_ecr_repository" "migrate" {
  name                 = "${local.name}/migrate"
  image_tag_mutability = "MUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }
}

resource "aws_ecr_repository" "worker" {
  name                 = "${local.name}/worker"
  image_tag_mutability = "MUTABLE"
  image_scanning_configuration { scan_on_push = true }
  encryption_configuration { encryption_type = "AES256" }
}

# Keep the last 10 tagged images; untagged layers go after a day.
locals {
  ecr_lifecycle_policy = jsonencode({
    rules = [
      {
        rulePriority = 1
        description  = "Keep the 10 most recent tagged images"
        selection = {
          tagStatus      = "tagged"
          tagPatternList = ["*"]
          countType      = "imageCountMoreThan"
          countNumber    = 10
        }
        action = { type = "expire" }
      },
      {
        rulePriority = 2
        description  = "Expire untagged images after 1 day"
        selection = {
          tagStatus   = "untagged"
          countType   = "sinceImagePushed"
          countUnit   = "days"
          countNumber = 1
        }
        action = { type = "expire" }
      },
    ]
  })
}

resource "aws_ecr_lifecycle_policy" "web" {
  repository = aws_ecr_repository.web.name
  policy     = local.ecr_lifecycle_policy
}

resource "aws_ecr_lifecycle_policy" "keycloak" {
  repository = aws_ecr_repository.keycloak.name
  policy     = local.ecr_lifecycle_policy
}

resource "aws_ecr_lifecycle_policy" "migrate" {
  repository = aws_ecr_repository.migrate.name
  policy     = local.ecr_lifecycle_policy
}

resource "aws_ecr_lifecycle_policy" "worker" {
  repository = aws_ecr_repository.worker.name
  policy     = local.ecr_lifecycle_policy
}

# ── Cluster ───────────────────────────────────────────────────

resource "aws_ecs_cluster" "main" {
  name = "${local.name}-cluster"

  setting {
    name  = "containerInsights"
    value = var.enable_container_insights ? "enabled" : "disabled"
  }
}

resource "aws_ecs_cluster_capacity_providers" "main" {
  cluster_name       = aws_ecs_cluster.main.name
  capacity_providers = ["FARGATE", "FARGATE_SPOT"]

  # Everything on regular Fargate by default. Spot is available for the web
  # service's burst capacity, configured on the service itself.
  default_capacity_provider_strategy {
    capacity_provider = "FARGATE"
    weight            = 1
    base              = var.web_min_capacity
  }
}

# ── Service discovery ─────────────────────────────────────────
# The web task calls Keycloak's internal endpoint directly. Cloud Map gives
# Keycloak a stable DNS name inside the VPC so that traffic never leaves for
# the public ALB and back.

resource "aws_service_discovery_private_dns_namespace" "main" {
  name        = "${var.project_name}.internal"
  description = "Internal service discovery for ${local.name}"
  vpc         = aws_vpc.main.id
}

resource "aws_service_discovery_service" "keycloak" {
  name = "keycloak"

  dns_config {
    namespace_id = aws_service_discovery_private_dns_namespace.main.id
    dns_records {
      ttl  = 10
      type = "A"
    }
    routing_policy = "MULTIVALUE"
  }

  health_check_custom_config {
    failure_threshold = 1
  }
}

# ── Logs ──────────────────────────────────────────────────────

resource "aws_cloudwatch_log_group" "web" {
  name              = "/ecs/${local.name}/web"
  retention_in_days = var.log_retention_days
}

resource "aws_cloudwatch_log_group" "keycloak" {
  name              = "/ecs/${local.name}/keycloak"
  retention_in_days = var.log_retention_days
}

resource "aws_cloudwatch_log_group" "migrate" {
  name              = "/ecs/${local.name}/migrate"
  retention_in_days = var.log_retention_days
}

resource "aws_cloudwatch_log_group" "worker" {
  name              = "/ecs/${local.name}/worker"
  retention_in_days = var.log_retention_days
}

# ── Derived URLs ──────────────────────────────────────────────

locals {
  scheme = local.https_enabled ? "https" : "http"

  app_base_url = var.domain_name != "" ? "${local.scheme}://${var.domain_name}" : "http://${aws_lb.main.dns_name}"

  # Issuer as the BROWSER sees it — also the `iss` claim the app verifies.
  keycloak_public_origin = local.keycloak_has_own_domain ? "${local.scheme}://${var.keycloak_domain_name}" : local.app_base_url
  keycloak_issuer        = "${local.keycloak_public_origin}/realms/${var.keycloak_realm}"

  # Issuer as the WEB TASK sees it, over Cloud Map. Plain HTTP inside the VPC.
  keycloak_internal_origin = "http://keycloak.${aws_service_discovery_private_dns_namespace.main.name}:8080"
  keycloak_internal_issuer = "${local.keycloak_internal_origin}/realms/${var.keycloak_realm}"
}

# ── Web task ──────────────────────────────────────────────────

resource "aws_ecs_task_definition" "web" {
  family                   = "${local.name}-web"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = var.web_cpu
  memory                   = var.web_memory
  execution_role_arn       = aws_iam_role.ecs_execution.arn
  task_role_arn            = aws_iam_role.ecs_task.arn

  runtime_platform {
    operating_system_family = "LINUX"
    cpu_architecture        = "X86_64"
  }

  container_definitions = jsonencode([
    {
      name      = "web"
      image     = "${aws_ecr_repository.web.repository_url}:latest"
      essential = true

      portMappings = [
        { containerPort = 3000, protocol = "tcp" }
      ]

      environment = [
        { name = "NODE_ENV", value = "production" },
        { name = "PORT", value = "3000" },
        { name = "APP_BASE_URL", value = local.app_base_url },
        { name = "DEFAULT_EVENT_SLUG", value = var.default_event_slug },
        # One ALB appends the client address to X-Forwarded-For.
        { name = "TRUSTED_PROXY_HOPS", value = "1" },
        { name = "GEMINI_LLM_MODEL", value = "gemini-3.8-flash" },
        { name = "KEYCLOAK_ISSUER", value = local.keycloak_issuer },
        { name = "KEYCLOAK_INTERNAL_ISSUER", value = local.keycloak_internal_issuer },
        { name = "KEYCLOAK_CLIENT_ID", value = var.keycloak_client_id },
        { name = "KEYCLOAK_GOOGLE_IDP_ALIAS", value = "google" },
        { name = "EMAIL_FROM", value = var.email_from },
        # RDS enforces TLS (rds.force_ssl), and the AWS CA is not in Node's
        # default trust store, so verification is relaxed for this hop inside
        # the VPC. Set DATABASE_CA_CERT to the RDS bundle to tighten it.
        { name = "DATABASE_SSL", value = "require" },
      ]

      secrets = [
        { name = "DATABASE_URL", valueFrom = local.secret_ref.DATABASE_URL },
        { name = "SESSION_SECRET", valueFrom = local.secret_ref.SESSION_SECRET },
        { name = "KEYCLOAK_CLIENT_SECRET", valueFrom = local.secret_ref.KEYCLOAK_CLIENT_SECRET },
        { name = "RESEND_API_KEY", valueFrom = local.secret_ref.RESEND_API_KEY },
        { name = "GEMINI_API_KEY", valueFrom = local.secret_ref.GEMINI_API_KEY },
        { name = "UPSTASH_REDIS_REST_URL", valueFrom = local.secret_ref.UPSTASH_REDIS_REST_URL },
        { name = "UPSTASH_REDIS_REST_TOKEN", valueFrom = local.secret_ref.UPSTASH_REDIS_REST_TOKEN },
      ]

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.web.name
          "awslogs-region"        = var.aws_region
          "awslogs-stream-prefix" = "web"
        }
      }

      healthCheck = {
        command     = ["CMD-SHELL", "curl -fsS http://127.0.0.1:3000/api/health || exit 1"]
        interval    = 30
        timeout     = 5
        retries     = 3
        startPeriod = 30
      }
    }
  ])
}

resource "aws_ecs_service" "web" {
  name            = "${local.name}-web"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.web.arn
  desired_count   = var.web_desired_count
  launch_type     = "FARGATE"

  # Rolling deploy that keeps full capacity up while the new version comes in.
  deployment_minimum_healthy_percent = 100
  deployment_maximum_percent         = 200
  health_check_grace_period_seconds  = 60
  enable_execute_command             = true

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  network_configuration {
    subnets          = var.enable_nat_gateway ? aws_subnet.private[*].id : aws_subnet.public[*].id
    security_groups  = [aws_security_group.ecs_tasks.id]
    assign_public_ip = !var.enable_nat_gateway
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.web.arn
    container_name   = "web"
    container_port   = 3000
  }

  lifecycle {
    # CI updates the image tag and the autoscaler owns the count, so Terraform
    # must not revert either on the next apply.
    ignore_changes = [task_definition, desired_count]
  }

  depends_on = [aws_lb_listener.http]
}

# ── Keycloak task ─────────────────────────────────────────────

resource "aws_ecs_task_definition" "keycloak" {
  family                   = "${local.name}-keycloak"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = var.keycloak_cpu
  memory                   = var.keycloak_memory
  execution_role_arn       = aws_iam_role.ecs_execution.arn
  task_role_arn            = aws_iam_role.ecs_task.arn

  container_definitions = jsonencode([
    {
      name      = "keycloak"
      image     = "${aws_ecr_repository.keycloak.repository_url}:latest"
      essential = true

      portMappings = [
        { containerPort = 8080, protocol = "tcp" },
        { containerPort = 9000, protocol = "tcp" },
      ]

      environment = [
        { name = "KC_DB", value = "postgres" },
        { name = "KC_DB_URL", value = local.keycloak_jdbc_url },
        { name = "KC_DB_USERNAME", value = aws_db_instance.main.username },
        # Tokens must be issued with the hostname the browser uses, or `iss`
        # will not match what the app verifies.
        { name = "KC_HOSTNAME", value = local.keycloak_public_origin },
        { name = "KC_HOSTNAME_STRICT", value = "false" },
        # TLS terminates at the ALB, so Keycloak speaks HTTP but must trust the
        # X-Forwarded-* headers to build correct absolute URLs.
        { name = "KC_PROXY_HEADERS", value = "xforwarded" },
        { name = "KC_HTTP_ENABLED", value = "true" },
        { name = "KC_HEALTH_ENABLED", value = "true" },
        { name = "KC_METRICS_ENABLED", value = "true" },
        { name = "KC_CACHE", value = "ispn" },
        { name = "KC_BOOTSTRAP_ADMIN_USERNAME", value = "admin" },
        { name = "APP_BASE_URL", value = local.app_base_url },
        { name = "JAVA_OPTS_APPEND", value = "-XX:MaxRAMPercentage=70" },
      ]

      secrets = [
        { name = "KC_DB_PASSWORD", valueFrom = local.secret_ref.KEYCLOAK_DB_PASSWORD },
        { name = "KC_BOOTSTRAP_ADMIN_PASSWORD", valueFrom = local.secret_ref.KEYCLOAK_ADMIN_PASSWORD },
        # Substituted into realm-export.json during import.
        { name = "KEYCLOAK_CLIENT_SECRET", valueFrom = local.secret_ref.KEYCLOAK_CLIENT_SECRET },
        { name = "GOOGLE_CLIENT_ID", valueFrom = local.secret_ref.GOOGLE_CLIENT_ID },
        { name = "GOOGLE_CLIENT_SECRET", valueFrom = local.secret_ref.GOOGLE_CLIENT_SECRET },
      ]

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.keycloak.name
          "awslogs-region"        = var.aws_region
          "awslogs-stream-prefix" = "keycloak"
        }
      }
    }
  ])
}

resource "aws_ecs_service" "keycloak" {
  name            = "${local.name}-keycloak"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.keycloak.arn
  desired_count   = var.keycloak_desired_count
  launch_type     = "FARGATE"

  deployment_minimum_healthy_percent = 100
  deployment_maximum_percent         = 200
  health_check_grace_period_seconds  = 180 # JVM + realm import
  enable_execute_command             = true

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  network_configuration {
    subnets          = var.enable_nat_gateway ? aws_subnet.private[*].id : aws_subnet.public[*].id
    security_groups  = [aws_security_group.ecs_tasks.id]
    assign_public_ip = !var.enable_nat_gateway
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.keycloak.arn
    container_name   = "keycloak"
    container_port   = 8080
  }

  service_registries {
    registry_arn = aws_service_discovery_service.keycloak.arn
  }

  lifecycle {
    ignore_changes = [task_definition, desired_count]
  }

  depends_on = [aws_lb_listener.http, aws_db_instance.main]
}

# ── Migration task ────────────────────────────────────────────
# Not a service. The deploy pipeline runs this once with `aws ecs run-task`
# before rolling out a new web version.

resource "aws_ecs_task_definition" "migrate" {
  family                   = "${local.name}-migrate"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = 256
  memory                   = 512
  execution_role_arn       = aws_iam_role.ecs_execution.arn
  task_role_arn            = aws_iam_role.ecs_task.arn

  container_definitions = jsonencode([
    {
      name      = "migrate"
      image     = "${aws_ecr_repository.migrate.repository_url}:latest"
      essential = true

      # Creates Keycloak's database on first run, then applies app migrations.
      # Both steps are idempotent, so re-running a deploy is safe.
      command = [
        "sh", "-c",
        "npx tsx packages/db/src/ensure-database.ts keycloak && npx tsx packages/db/src/migrate.ts"
      ]

      environment = [
        { name = "NODE_ENV", value = "production" },
        { name = "DATABASE_SSL", value = "require" },
        # Seeding is for local development only; production data comes from the
        # Excel importer.
        { name = "SEED_ON_MIGRATE", value = "false" },
      ]

      secrets = [
        { name = "DATABASE_URL", valueFrom = local.secret_ref.DATABASE_URL },
      ]

      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.migrate.name
          "awslogs-region"        = var.aws_region
          "awslogs-stream-prefix" = "migrate"
        }
      }
    }
  ])
}

# Long-running consumer for profile embeddings and match computation.
resource "aws_ecs_task_definition" "worker" {
  family                   = "${local.name}-worker"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = var.worker_cpu
  memory                   = var.worker_memory
  execution_role_arn       = aws_iam_role.ecs_execution.arn
  task_role_arn            = aws_iam_role.ecs_task.arn

  container_definitions = jsonencode([
    {
      name      = "worker"
      image     = "${aws_ecr_repository.worker.repository_url}:latest"
      essential = true
      environment = [
        { name = "NODE_ENV", value = "production" },
        { name = "DATABASE_SSL", value = "require" },
        { name = "GEMINI_LLM_MODEL", value = "gemini-3.8-flash" },
        { name = "EMBEDDING_PROVIDER", value = "gemini" },
      ]
      secrets = [
        { name = "DATABASE_URL", valueFrom = local.secret_ref.DATABASE_URL },
        { name = "GEMINI_API_KEY", valueFrom = local.secret_ref.GEMINI_API_KEY },
        { name = "UPSTASH_REDIS_REST_URL", valueFrom = local.secret_ref.UPSTASH_REDIS_REST_URL },
        { name = "UPSTASH_REDIS_REST_TOKEN", valueFrom = local.secret_ref.UPSTASH_REDIS_REST_TOKEN },
      ]
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.worker.name
          "awslogs-region"        = var.aws_region
          "awslogs-stream-prefix" = "worker"
        }
      }
    }
  ])
}

resource "aws_ecs_service" "worker" {
  name            = "${local.name}-worker"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.worker.arn
  desired_count   = var.worker_desired_count
  launch_type     = "FARGATE"

  deployment_minimum_healthy_percent = 100
  deployment_maximum_percent         = 200
  enable_execute_command             = true

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  network_configuration {
    subnets          = var.enable_nat_gateway ? aws_subnet.private[*].id : aws_subnet.public[*].id
    security_groups  = [aws_security_group.ecs_tasks.id]
    assign_public_ip = !var.enable_nat_gateway
  }

  lifecycle {
    ignore_changes = [task_definition]
  }

  depends_on = [aws_db_instance.main]
}
