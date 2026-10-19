variable "aws_region" {
  description = "AWS region for every resource in this stack."
  type        = string
  default     = "ap-south-1"
}

variable "project_name" {
  description = "Short name used to prefix resource names."
  type        = string
  default     = "match-maker"
}

variable "default_event_slug" {
  description = "Event slug used by the web root redirect."
  type        = string
  default     = "demo"
}

variable "environment" {
  description = "Deployment environment (prod, staging, …)."
  type        = string
  default     = "prod"
}

# ── Networking ────────────────────────────────────────────────
variable "vpc_cidr" {
  description = "CIDR block for the VPC."
  type        = string
  default     = "10.20.0.0/16"
}

variable "availability_zone_count" {
  description = "Number of AZs to spread subnets across. ALB requires at least 2."
  type        = number
  default     = 2

  validation {
    condition     = var.availability_zone_count >= 2
    error_message = "An Application Load Balancer needs subnets in at least 2 availability zones."
  }
}

variable "enable_nat_gateway" {
  description = <<-EOT
    Place tasks in private subnets behind a NAT gateway.

    NAT costs roughly USD 32/month per AZ before data charges. Set false to run
    tasks in public subnets with public IPs — cheaper, and still not directly
    reachable because the security group only admits traffic from the ALB.
  EOT
  type        = bool
  default     = true
}

# ── DNS / TLS ─────────────────────────────────────────────────
variable "domain_name" {
  description = "Public hostname for the app, e.g. bridge.example.com. Required (with acm_certificate_arn) when environment is prod; leave empty only for a non-prod evaluation stack served over HTTP."
  type        = string
  default     = ""
}

variable "keycloak_domain_name" {
  description = "Public hostname for Keycloak, e.g. auth.example.com. Leave empty to expose Keycloak on /auth of the app domain."
  type        = string
  default     = ""
}

variable "acm_certificate_arn" {
  description = "ARN of an existing ACM certificate covering the domains above. Required for HTTPS."
  type        = string
  default     = ""
}

variable "keycloak_admin_cidrs" {
  description = "IPv4 CIDR blocks allowed to reach the Keycloak admin console (/admin) through the load balancer. Empty keeps it unreachable from the internet; use ECS Exec port forwarding instead."
  type        = list(string)
  default     = []
}

variable "route53_zone_id" {
  description = "Route53 hosted zone to create records in. Leave empty to manage DNS elsewhere."
  type        = string
  default     = ""
}

# ── Database ──────────────────────────────────────────────────
variable "db_instance_class" {
  description = "RDS instance class."
  type        = string
  default     = "db.t4g.micro"
}

variable "db_allocated_storage" {
  description = "Initial storage in GiB."
  type        = number
  default     = 20
}

variable "db_max_allocated_storage" {
  description = "Upper bound for RDS storage autoscaling, in GiB."
  type        = number
  default     = 100
}

variable "db_multi_az" {
  description = "Run a standby in a second AZ. Doubles cost, removes the single-AZ failure mode."
  type        = bool
  default     = false
}

variable "db_backup_retention_days" {
  description = "Automated backup retention, in days."
  type        = number
  default     = 7
}

variable "db_deletion_protection" {
  description = "Block `terraform destroy` from dropping the database."
  type        = bool
  default     = true
}

# ── Web service sizing ────────────────────────────────────────
variable "web_cpu" {
  description = "Fargate CPU units for the web task (1024 = 1 vCPU)."
  type        = number
  default     = 512
}

variable "web_memory" {
  description = "Fargate memory (MiB) for the web task."
  type        = number
  default     = 1024
}

variable "web_desired_count" {
  description = "Baseline task count before autoscaling acts."
  type        = number
  default     = 2
}

variable "web_min_capacity" {
  description = "Autoscaling floor for the web service."
  type        = number
  default     = 2
}

variable "web_max_capacity" {
  description = "Autoscaling ceiling for the web service."
  type        = number
  default     = 10
}

variable "web_cpu_target" {
  description = "Target average CPU percentage for the web service."
  type        = number
  default     = 60
}

variable "web_memory_target" {
  description = "Target average memory percentage for the web service."
  type        = number
  default     = 75
}

variable "web_requests_per_target" {
  description = "Target ALB requests per task per minute. Scales on traffic before CPU reacts."
  type        = number
  default     = 1000
}

variable "worker_cpu" {
  description = "Fargate CPU units for the asynchronous matching worker."
  type        = number
  default     = 512
}

variable "worker_memory" {
  description = "Fargate memory in MiB for the asynchronous matching worker."
  type        = number
  default     = 1024
}

variable "worker_desired_count" {
  description = "Number of asynchronous matching workers."
  type        = number
  default     = 1
}

# ── Keycloak sizing ───────────────────────────────────────────
variable "keycloak_cpu" {
  description = "Fargate CPU units for the Keycloak task."
  type        = number
  default     = 1024
}

variable "keycloak_memory" {
  description = "Fargate memory (MiB) for the Keycloak task. The JVM needs headroom."
  type        = number
  default     = 2048
}

variable "keycloak_desired_count" {
  description = "Baseline Keycloak task count."
  type        = number
  default     = 1
}

variable "keycloak_min_capacity" {
  type        = number
  description = "Autoscaling floor for Keycloak."
  default     = 1
}

variable "keycloak_max_capacity" {
  type        = number
  description = "Autoscaling ceiling for Keycloak."
  default     = 4
}

variable "keycloak_image" {
  description = "Keycloak container image."
  type        = string
  default     = "quay.io/keycloak/keycloak:26.0"
}

variable "keycloak_realm" {
  description = "Realm name. Must match the realm in keycloak/realm-export.json."
  type        = string
  default     = "match-maker"
}

variable "keycloak_client_id" {
  description = "OIDC client id for the web app."
  type        = string
  default     = "match-maker-web"
}

# ── Application secrets ───────────────────────────────────────
# Values are supplied out-of-band and stored in Secrets Manager; only their
# presence is described here. Never put real values in a .tfvars that is committed.
variable "gemini_api_key" {
  description = "Google Gemini API key for matchmaking."
  type        = string
  sensitive   = true
  default     = ""
}

variable "upstash_redis_rest_url" {
  description = "Optional Upstash Redis REST URL for the shared candidate retrieval cache."
  type        = string
  sensitive   = true
  default     = ""
}

variable "upstash_redis_rest_token" {
  description = "Optional Upstash Redis REST token for the shared candidate retrieval cache."
  type        = string
  sensitive   = true
  default     = ""
}

variable "resend_api_key" {
  description = "Resend API key for login e-mails."
  type        = string
  sensitive   = true
  default     = ""
}

variable "email_from" {
  description = "From address for login e-mails. The domain must be verified in Resend."
  type        = string
  default     = "Mr. Bridge <login@example.com>"
}

variable "google_client_id" {
  description = "Google OAuth client id used by the Keycloak identity provider."
  type        = string
  sensitive   = true
  default     = ""
}

variable "google_client_secret" {
  description = "Google OAuth client secret used by the Keycloak identity provider."
  type        = string
  sensitive   = true
  default     = ""
}

# ── Observability ─────────────────────────────────────────────
variable "log_retention_days" {
  description = "CloudWatch log retention."
  type        = number
  default     = 30
}

variable "alarm_email" {
  description = "Address subscribed to the alarm SNS topic. Leave empty to skip notifications."
  type        = string
  default     = ""
}

variable "enable_container_insights" {
  description = "Enable ECS Container Insights. Adds CloudWatch cost."
  type        = bool
  default     = true
}

variable "session_secret_active" {
  description = "Which session-secret slot seals new cookies (a or b); the other is still accepted. Flip it, with -replace of the newly active slot, to rotate without signing anyone out."
  type        = string
  default     = "a"

  validation {
    condition     = contains(["a", "b"], var.session_secret_active)
    error_message = "session_secret_active must be \"a\" or \"b\"."
  }
}
