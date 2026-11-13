# ==============================================================
# Application Load Balancer.
#
# One ALB fronts both services. Keycloak is routed either by its own
# hostname or, when no separate domain is given, by the /realms and
# /resources path prefixes on the app domain.
# ==============================================================

resource "aws_lb" "main" {
  name               = substr("${local.name}-alb", 0, 32)
  internal           = false
  load_balancer_type = "application"
  security_groups    = [aws_security_group.alb.id]
  subnets            = aws_subnet.public[*].id

  # OIDC redirects carry state in the query string; a slow drain avoids
  # cutting a login in half during a deploy.
  idle_timeout               = 60
  enable_deletion_protection = var.environment == "prod"
  drop_invalid_header_fields = true

  tags = { Name = "${local.name}-alb" }
}

resource "aws_lb_target_group" "web" {
  name        = substr("${local.name}-web-tg", 0, 32)
  port        = 3000
  protocol    = "HTTP"
  vpc_id      = aws_vpc.main.id
  target_type = "ip"

  health_check {
    enabled = true
    path    = "/api/health"
    matcher = "200"
    # Dependency-free by design — see app/api/health/route.js for why this must
    # not check Postgres or Keycloak.
    interval            = 30
    timeout             = 5
    healthy_threshold   = 2
    unhealthy_threshold = 3
  }

  # Give in-flight requests time to finish before a task is killed.
  deregistration_delay = 30

  stickiness {
    enabled = false
    type    = "lb_cookie"
  }

  tags = { Name = "${local.name}-web-tg" }

  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_lb_target_group" "keycloak" {
  name        = substr("${local.name}-kc-tg", 0, 32)
  port        = 8080
  protocol    = "HTTP"
  vpc_id      = aws_vpc.main.id
  target_type = "ip"

  health_check {
    enabled = true
    # Keycloak 25+ serves health on the management port, but /realms/<realm>
    # is a cheap public endpoint that proves the realm actually imported.
    path                = "/realms/${var.keycloak_realm}"
    matcher             = "200"
    interval            = 30
    timeout             = 10
    healthy_threshold   = 2
    unhealthy_threshold = 5
  }

  deregistration_delay = 30

  # Keycloak's login flow keeps state server-side, so a user mid-login must
  # keep hitting the same task.
  stickiness {
    enabled         = true
    type            = "lb_cookie"
    cookie_duration = 3600
  }

  tags = { Name = "${local.name}-kc-tg" }

  lifecycle {
    create_before_destroy = true
  }
}

locals {
  https_enabled = var.acm_certificate_arn != ""
}

# ── HTTP listener ─────────────────────────────────────────────
# Redirects to HTTPS when a certificate exists; otherwise serves directly so the
# stack is still usable on the ALB's own DNS name before DNS/TLS is set up.
resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.main.arn
  port              = 80
  protocol          = "HTTP"

  lifecycle {
    # Production must never serve logins and session cookies over plain HTTP.
    precondition {
      condition     = var.environment != "prod" || (local.https_enabled && var.domain_name != "")
      error_message = "environment = \"prod\" requires domain_name and acm_certificate_arn so the app is served over HTTPS."
    }
  }

  dynamic "default_action" {
    for_each = local.https_enabled ? [1] : []
    content {
      type = "redirect"
      redirect {
        port        = "443"
        protocol    = "HTTPS"
        status_code = "HTTP_301"
      }
    }
  }

  dynamic "default_action" {
    for_each = local.https_enabled ? [] : [1]
    content {
      type             = "forward"
      target_group_arn = aws_lb_target_group.web.arn
    }
  }
}

resource "aws_lb_listener" "https" {
  count = local.https_enabled ? 1 : 0

  load_balancer_arn = aws_lb.main.arn
  port              = 443
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn   = var.acm_certificate_arn

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.web.arn
  }
}

# ── Keycloak routing ──────────────────────────────────────────

locals {
  active_listener_arn     = local.https_enabled ? aws_lb_listener.https[0].arn : aws_lb_listener.http.arn
  keycloak_has_own_domain = var.keycloak_domain_name != ""
}

# Preferred: Keycloak on its own hostname.
resource "aws_lb_listener_rule" "keycloak_host" {
  count = local.keycloak_has_own_domain ? 1 : 0

  listener_arn = local.active_listener_arn
  priority     = 10

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.keycloak.arn
  }

  condition {
    host_header {
      values = [var.keycloak_domain_name]
    }
  }
}

# The admin console is not public: only var.keycloak_admin_cidrs reach it, and
# everyone else gets a 404 before the request is routed to Keycloak. The app's
# own admin API calls go over Cloud Map inside the VPC, not through the ALB.
resource "aws_lb_listener_rule" "keycloak_admin_allow" {
  count = length(var.keycloak_admin_cidrs) > 0 ? 1 : 0

  listener_arn = local.active_listener_arn
  priority     = 5

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.keycloak.arn
  }

  condition {
    path_pattern {
      values = ["/admin", "/admin/*"]
    }
  }

  condition {
    source_ip {
      values = var.keycloak_admin_cidrs
    }
  }
}

resource "aws_lb_listener_rule" "keycloak_admin_deny" {
  listener_arn = local.active_listener_arn
  priority     = 6

  action {
    type = "fixed-response"
    fixed_response {
      content_type = "text/plain"
      message_body = "Not found"
      status_code  = "404"
    }
  }

  condition {
    path_pattern {
      values = ["/admin", "/admin/*"]
    }
  }
}

# Fallback: share the app hostname and split on the paths Keycloak owns.
# /auth/callback belongs to the APP, and is not listed here. /admin/* is
# handled by the two rules above.
resource "aws_lb_listener_rule" "keycloak_path" {
  count = local.keycloak_has_own_domain ? 0 : 1

  listener_arn = local.active_listener_arn
  priority     = 20

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.keycloak.arn
  }

  condition {
    path_pattern {
      values = ["/realms/*", "/resources/*", "/js/*"]
    }
  }
}

# ── DNS ───────────────────────────────────────────────────────

resource "aws_route53_record" "app" {
  count = var.route53_zone_id != "" && var.domain_name != "" ? 1 : 0

  zone_id = var.route53_zone_id
  name    = var.domain_name
  type    = "A"

  alias {
    name                   = aws_lb.main.dns_name
    zone_id                = aws_lb.main.zone_id
    evaluate_target_health = true
  }
}

resource "aws_route53_record" "keycloak" {
  count = var.route53_zone_id != "" && local.keycloak_has_own_domain ? 1 : 0

  zone_id = var.route53_zone_id
  name    = var.keycloak_domain_name
  type    = "A"

  alias {
    name                   = aws_lb.main.dns_name
    zone_id                = aws_lb.main.zone_id
    evaluate_target_health = true
  }
}
