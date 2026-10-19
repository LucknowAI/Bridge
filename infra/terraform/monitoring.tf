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
  # The web and worker write metrics here (CloudWatch embedded metric format).
  metrics_namespace = "MatchMaker/${var.environment}"
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

# ── Pipeline ──────────────────────────────────────────────────
# Written by the worker once a minute and by every search. Each alarm names
# the runbook section in docs/OPERATIONS.md that says what to do.

locals {
  pipeline_alarms = {
    worker-down = {
      description = "No worker heartbeat for 5 minutes: matching and notifications have stopped. Runbook: Worker down."
      metric      = "WorkerHeartbeat"
      statistic   = "SampleCount"
      period      = 300
      periods     = 1
      threshold   = 1
      comparison  = "LessThanThreshold"
      missing     = "breaching"
    }
    matching-backlog = {
      description = "A due matching job has waited over 10 minutes. Runbook: Matching backlog."
      metric      = "OldestDueJobSeconds"
      statistic   = "Maximum"
      period      = 300
      periods     = 2
      threshold   = 600
      comparison  = "GreaterThanThreshold"
      missing     = "notBreaching"
    }
    jobs-failed = {
      description = "Matching jobs failed after every retry. Runbook: Failed jobs (npm run jobs:failed)."
      metric      = "JobsFailed"
      statistic   = "Maximum"
      period      = 300
      periods     = 1
      threshold   = 0
      comparison  = "GreaterThanThreshold"
      missing     = "notBreaching"
    }
    notification-backlog = {
      description = "A due notification has waited over 10 minutes. Runbook: Notifications stuck."
      metric      = "OldestDueNotificationSeconds"
      statistic   = "Maximum"
      period      = 300
      periods     = 2
      threshold   = 600
      comparison  = "GreaterThanThreshold"
      missing     = "notBreaching"
    }
    notifications-failed = {
      description = "Notifications failed after every retry. Runbook: Notifications stuck."
      metric      = "NotificationsFailed"
      statistic   = "Maximum"
      period      = 300
      periods     = 1
      threshold   = 0
      comparison  = "GreaterThanThreshold"
      missing     = "notBreaching"
    }
    search-slow = {
      description = "Search p95 above its 6 s budget for 15 minutes. Runbook: Slow search."
      metric      = "SearchLatencyMs"
      statistic   = "p95"
      period      = 300
      periods     = 3
      threshold   = 6000
      comparison  = "GreaterThanThreshold"
      missing     = "notBreaching"
    }
    search-failing = {
      description = "More than 5 searches failed in 5 minutes. Runbook: Slow search."
      metric      = "SearchFailures"
      statistic   = "Sum"
      period      = 300
      periods     = 1
      threshold   = 5
      comparison  = "GreaterThanThreshold"
      missing     = "notBreaching"
    }
  }
}

resource "aws_cloudwatch_metric_alarm" "pipeline" {
  for_each = local.pipeline_alarms

  alarm_name          = "${local.name}-${each.key}"
  alarm_description   = each.value.description
  namespace           = local.metrics_namespace
  metric_name         = each.value.metric
  statistic           = each.value.statistic == "p95" ? null : each.value.statistic
  extended_statistic  = each.value.statistic == "p95" ? "p95" : null
  period              = each.value.period
  evaluation_periods  = each.value.periods
  threshold           = each.value.threshold
  comparison_operator = each.value.comparison
  treat_missing_data  = each.value.missing

  alarm_actions = local.alarm_actions
  ok_actions    = local.alarm_actions
}

# Model failures are expected occasionally (the gateway falls back); only a
# sustained rate needs a person, e.g. an expired key or an exhausted quota.
resource "aws_cloudwatch_metric_alarm" "model_failures" {
  alarm_name          = "${local.name}-model-failures"
  alarm_description   = "Over 20% of model calls failing for 15 minutes; matching runs on fallbacks. Runbook: Model provider failing."
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 3
  threshold           = 20
  treat_missing_data  = "notBreaching"

  metric_query {
    id          = "rate"
    expression  = "IF(calls > 0, 100 * failures / calls, 0)"
    label       = "Model call failure %"
    return_data = true
  }

  metric_query {
    id         = "failures"
    expression = join(" + ", [for op in local.model_operations : "f_${replace(op, ":", "_")}"])
  }

  metric_query {
    id         = "calls"
    expression = join(" + ", [for op in local.model_operations : "c_${replace(op, ":", "_")}"])
  }

  dynamic "metric_query" {
    for_each = { for pair in setproduct(local.model_operations, ["f", "c"]) : "${pair[1]}_${replace(pair[0], ":", "_")}" => pair }
    content {
      id = metric_query.key
      metric {
        namespace   = local.metrics_namespace
        metric_name = metric_query.value[1] == "f" ? "ModelCallFailures" : "ModelCalls"
        dimensions  = { Operation = metric_query.value[0] }
        period      = 300
        stat        = "Sum"
      }
    }
  }

  alarm_actions = local.alarm_actions
}

locals {
  model_operations = ["embed:profile", "embed:query", "rerank"]
}

resource "aws_cloudwatch_dashboard" "main" {
  dashboard_name = local.name
  dashboard_body = jsonencode({
    widgets = [
      for index, widget in [
        { title = "Search latency (ms)", metrics = [[local.metrics_namespace, "SearchLatencyMs", { stat = "p50" }], ["...", { stat = "p95" }]] },
        { title = "Queue wait (s)", metrics = [[local.metrics_namespace, "OldestDueJobSeconds"], [local.metrics_namespace, "OldestDueNotificationSeconds"]] },
        { title = "Queue size", metrics = [[local.metrics_namespace, "JobsPending"], [local.metrics_namespace, "NotificationsPending"]] },
        { title = "Failed for good", metrics = [[local.metrics_namespace, "JobsFailed"], [local.metrics_namespace, "NotificationsFailed"]] },
        { title = "Model call failures by operation", metrics = [for op in local.model_operations : [local.metrics_namespace, "ModelCallFailures", "Operation", op, { stat = "Sum" }]] },
        { title = "Web response time (s)", metrics = [["AWS/ApplicationELB", "TargetResponseTime", "LoadBalancer", aws_lb.main.arn_suffix, { stat = "p95" }]] },
        ] : {
        type   = "metric"
        x      = (index % 2) * 12
        y      = floor(index / 2) * 6
        width  = 12
        height = 6
        properties = {
          title   = widget.title
          metrics = widget.metrics
          region  = var.aws_region
          stat    = "Maximum"
          period  = 300
          view    = "timeSeries"
        }
      }
    ]
  })
}
