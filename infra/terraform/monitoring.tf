# ==============================================================
# CloudWatch alarms. Every alarm here is one a human should act on;
# anything purely informational belongs on a dashboard instead.
# ==============================================================

resource "aws_sns_topic" "alarms" {
  name = "${local.name}-alarms"
}

resource "aws_sns_topic_subscription" "alarm_email" {
  count = var.alarm_email != "" ? 1 : 0

  topic_arn = aws_sns_topic.alarms.arn
  protocol  = "email"
  endpoint  = var.alarm_email
}

locals {
  alarm_actions = [aws_sns_topic.alarms.arn]
}

# ── Availability ──────────────────────────────────────────────

resource "aws_cloudwatch_metric_alarm" "web_no_healthy_hosts" {
  alarm_name          = "${local.name}-web-no-healthy-hosts"
  alarm_description   = "No healthy web tasks behind the ALB — the site is down."
  namespace           = "AWS/ApplicationELB"
  metric_name         = "HealthyHostCount"
  statistic           = "Minimum"
  period              = 60
  evaluation_periods  = 2
  threshold           = 1
  comparison_operator = "LessThanThreshold"
  treat_missing_data  = "breaching"

  dimensions = {
    LoadBalancer = aws_lb.main.arn_suffix
    TargetGroup  = aws_lb_target_group.web.arn_suffix
  }

  alarm_actions = local.alarm_actions
  ok_actions    = local.alarm_actions
}

resource "aws_cloudwatch_metric_alarm" "keycloak_no_healthy_hosts" {
  alarm_name          = "${local.name}-keycloak-no-healthy-hosts"
  alarm_description   = "No healthy Keycloak tasks — nobody can sign in."
  namespace           = "AWS/ApplicationELB"
  metric_name         = "HealthyHostCount"
  statistic           = "Minimum"
  period              = 60
  evaluation_periods  = 3
  threshold           = 1
  comparison_operator = "LessThanThreshold"
  treat_missing_data  = "breaching"

  dimensions = {
    LoadBalancer = aws_lb.main.arn_suffix
    TargetGroup  = aws_lb_target_group.keycloak.arn_suffix
  }

  alarm_actions = local.alarm_actions
  ok_actions    = local.alarm_actions
}

resource "aws_cloudwatch_metric_alarm" "alb_5xx" {
  alarm_name          = "${local.name}-alb-5xx"
  alarm_description   = "Sustained 5xx responses from the application."
  namespace           = "AWS/ApplicationELB"
  metric_name         = "HTTPCode_Target_5XX_Count"
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 2
  threshold           = 25
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"

  dimensions = {
    LoadBalancer = aws_lb.main.arn_suffix
  }

  alarm_actions = local.alarm_actions
}

resource "aws_cloudwatch_metric_alarm" "alb_latency" {
  alarm_name          = "${local.name}-alb-p95-latency"
  alarm_description   = "p95 response time above 5s. Matching calls Gemini, so this is generous."
  namespace           = "AWS/ApplicationELB"
  metric_name         = "TargetResponseTime"
  extended_statistic  = "p95"
  period              = 300
  evaluation_periods  = 3
  threshold           = 5
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"

  dimensions = {
    LoadBalancer = aws_lb.main.arn_suffix
  }

  alarm_actions = local.alarm_actions
}

# ── Saturation ────────────────────────────────────────────────

resource "aws_cloudwatch_metric_alarm" "web_at_max_capacity" {
  alarm_name          = "${local.name}-web-at-max-capacity"
  alarm_description   = "Web service is pinned at its autoscaling ceiling — raise web_max_capacity."
  namespace           = "ECS/ContainerInsights"
  metric_name         = "RunningTaskCount"
  statistic           = "Average"
  period              = 300
  evaluation_periods  = 3
  threshold           = var.web_max_capacity
  comparison_operator = "GreaterThanOrEqualToThreshold"
  treat_missing_data  = "notBreaching"

  dimensions = {
    ClusterName = aws_ecs_cluster.main.name
    ServiceName = aws_ecs_service.web.name
  }

  alarm_actions = local.alarm_actions
}

# ── Database ──────────────────────────────────────────────────

resource "aws_cloudwatch_metric_alarm" "rds_cpu" {
  alarm_name          = "${local.name}-rds-cpu"
  alarm_description   = "Database CPU sustained above 80%."
  namespace           = "AWS/RDS"
  metric_name         = "CPUUtilization"
  statistic           = "Average"
  period              = 300
  evaluation_periods  = 3
  threshold           = 80
  comparison_operator = "GreaterThanThreshold"

  dimensions = {
    DBInstanceIdentifier = aws_db_instance.main.id
  }

  alarm_actions = local.alarm_actions
}

resource "aws_cloudwatch_metric_alarm" "rds_storage" {
  alarm_name          = "${local.name}-rds-free-storage"
  alarm_description   = "Less than 2 GiB of database storage free."
  namespace           = "AWS/RDS"
  metric_name         = "FreeStorageSpace"
  statistic           = "Minimum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 2 * 1024 * 1024 * 1024
  comparison_operator = "LessThanThreshold"

  dimensions = {
    DBInstanceIdentifier = aws_db_instance.main.id
  }

  alarm_actions = local.alarm_actions
}

resource "aws_cloudwatch_metric_alarm" "rds_connections" {
  alarm_name         = "${local.name}-rds-connections"
  alarm_description  = "Connection count climbing — check for pool leaks across scaled-out tasks."
  namespace          = "AWS/RDS"
  metric_name        = "DatabaseConnections"
  statistic          = "Average"
  period             = 300
  evaluation_periods = 2
  # Each web task opens up to DATABASE_POOL_MAX (10); alarm well before
  # db.t4g.micro's ~85 connection ceiling.
  threshold           = 60
  comparison_operator = "GreaterThanThreshold"

  dimensions = {
    DBInstanceIdentifier = aws_db_instance.main.id
  }

  alarm_actions = local.alarm_actions
}

# ── Application-level ─────────────────────────────────────────
# Login e-mail failures are invisible in infrastructure metrics: the request
# returns 500 but the user just sees "try again". This turns the log line into
# an alarm.

resource "aws_cloudwatch_log_metric_filter" "login_email_failures" {
  name           = "${local.name}-login-email-failures"
  log_group_name = aws_cloudwatch_log_group.web.name
  pattern        = "\"[auth/otp/request]\""

  metric_transformation {
    name          = "LoginEmailFailures"
    namespace     = "MatchMaker/${var.environment}"
    value         = "1"
    unit          = "Count"
    default_value = 0
  }
}

resource "aws_cloudwatch_metric_alarm" "login_email_failures" {
  alarm_name          = "${local.name}-login-email-failures"
  alarm_description   = "Login e-mails are failing to send — users cannot sign in."
  namespace           = "MatchMaker/${var.environment}"
  metric_name         = aws_cloudwatch_log_metric_filter.login_email_failures.metric_transformation[0].name
  statistic           = "Sum"
  period              = 300
  evaluation_periods  = 1
  threshold           = 5
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching"

  alarm_actions = local.alarm_actions
}
