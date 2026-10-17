# ==============================================================
# Application Auto Scaling for the ECS services.
#
# The web service scales on three signals at once. Application Auto Scaling
# takes the LARGEST capacity any policy asks for, so these compose safely:
#   · request count  — reacts to traffic before it becomes load
#   · CPU            — catches expensive work (Gemini calls, JSON parsing)
#   · memory         — catches leaks and heavy concurrency
#
# Scale-in is deliberately slower than scale-out everywhere: adding a task
# costs money, removing one too eagerly costs availability.
# ==============================================================

resource "aws_appautoscaling_target" "web" {
  service_namespace  = "ecs"
  resource_id        = "service/${aws_ecs_cluster.main.name}/${aws_ecs_service.web.name}"
  scalable_dimension = "ecs:service:DesiredCount"
  min_capacity       = var.web_min_capacity
  max_capacity       = var.web_max_capacity
}

resource "aws_appautoscaling_policy" "web_cpu" {
  name               = "${local.name}-web-cpu"
  policy_type        = "TargetTrackingScaling"
  service_namespace  = aws_appautoscaling_target.web.service_namespace
  resource_id        = aws_appautoscaling_target.web.resource_id
  scalable_dimension = aws_appautoscaling_target.web.scalable_dimension

  target_tracking_scaling_policy_configuration {
    predefined_metric_specification {
      predefined_metric_type = "ECSServiceAverageCPUUtilization"
    }
    target_value = var.web_cpu_target

    # A new task needs ~40s to boot and pass health checks; 60s avoids stacking
    # up duplicate scale-outs while the first one is still starting.
    scale_out_cooldown = 60
    scale_in_cooldown  = 300
  }
}

resource "aws_appautoscaling_policy" "web_memory" {
  name               = "${local.name}-web-memory"
  policy_type        = "TargetTrackingScaling"
  service_namespace  = aws_appautoscaling_target.web.service_namespace
  resource_id        = aws_appautoscaling_target.web.resource_id
  scalable_dimension = aws_appautoscaling_target.web.scalable_dimension

  target_tracking_scaling_policy_configuration {
    predefined_metric_specification {
      predefined_metric_type = "ECSServiceAverageMemoryUtilization"
    }
    target_value       = var.web_memory_target
    scale_out_cooldown = 60
    scale_in_cooldown  = 300
  }
}

resource "aws_appautoscaling_policy" "web_requests" {
  name               = "${local.name}-web-requests"
  policy_type        = "TargetTrackingScaling"
  service_namespace  = aws_appautoscaling_target.web.service_namespace
  resource_id        = aws_appautoscaling_target.web.resource_id
  scalable_dimension = aws_appautoscaling_target.web.scalable_dimension

  target_tracking_scaling_policy_configuration {
    predefined_metric_specification {
      predefined_metric_type = "ALBRequestCountPerTarget"
      # ALB + target group, in the ARN-suffix form this metric expects.
      resource_label = "${aws_lb.main.arn_suffix}/${aws_lb_target_group.web.arn_suffix}"
    }
    target_value       = var.web_requests_per_target
    scale_out_cooldown = 60
    scale_in_cooldown  = 300
  }
}

# Event traffic is bursty and predictable: everyone signs in when the session
# starts. This pre-warms capacity on weekday evenings (IST) so the first users
# don't absorb a cold scale-out.
resource "aws_appautoscaling_scheduled_action" "web_evening_warmup" {
  name               = "${local.name}-web-evening-warmup"
  service_namespace  = aws_appautoscaling_target.web.service_namespace
  resource_id        = aws_appautoscaling_target.web.resource_id
  scalable_dimension = aws_appautoscaling_target.web.scalable_dimension
  schedule           = "cron(0 12 ? * MON-FRI *)" # 17:30 IST
  timezone           = "UTC"

  scalable_target_action {
    min_capacity = max(var.web_min_capacity, 3)
    max_capacity = var.web_max_capacity
  }
}

resource "aws_appautoscaling_scheduled_action" "web_night_scaledown" {
  name               = "${local.name}-web-night-scaledown"
  service_namespace  = aws_appautoscaling_target.web.service_namespace
  resource_id        = aws_appautoscaling_target.web.resource_id
  scalable_dimension = aws_appautoscaling_target.web.scalable_dimension
  schedule           = "cron(0 18 ? * MON-FRI *)" # 23:30 IST
  timezone           = "UTC"

  scalable_target_action {
    min_capacity = var.web_min_capacity
    max_capacity = var.web_max_capacity
  }
}

# ── Keycloak ──────────────────────────────────────────────────
# Scales on CPU only. Login traffic is a small fraction of app traffic, and
# Keycloak's Infinispan cluster prefers a stable membership — so the ceiling is
# low and scale-in is very slow.

resource "aws_appautoscaling_target" "keycloak" {
  service_namespace  = "ecs"
  resource_id        = "service/${aws_ecs_cluster.main.name}/${aws_ecs_service.keycloak.name}"
  scalable_dimension = "ecs:service:DesiredCount"
  min_capacity       = var.keycloak_min_capacity
  max_capacity       = var.keycloak_max_capacity
}

resource "aws_appautoscaling_policy" "keycloak_cpu" {
  name               = "${local.name}-keycloak-cpu"
  policy_type        = "TargetTrackingScaling"
  service_namespace  = aws_appautoscaling_target.keycloak.service_namespace
  resource_id        = aws_appautoscaling_target.keycloak.resource_id
  scalable_dimension = aws_appautoscaling_target.keycloak.scalable_dimension

  target_tracking_scaling_policy_configuration {
    predefined_metric_specification {
      predefined_metric_type = "ECSServiceAverageCPUUtilization"
    }
    target_value = 70

    # A Keycloak task takes well over a minute to become useful, so give a
    # scale-out time to land before considering another.
    scale_out_cooldown = 180
    scale_in_cooldown  = 600
  }
}
