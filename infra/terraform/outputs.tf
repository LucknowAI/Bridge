output "app_url" {
  description = "Public URL of the application."
  value       = local.app_base_url
}

output "alb_dns_name" {
  description = "ALB hostname. Point your CNAME/ALIAS here."
  value       = aws_lb.main.dns_name
}

output "keycloak_issuer" {
  description = "Public OIDC issuer. Matches the `iss` claim the app verifies."
  value       = local.keycloak_issuer
}

output "keycloak_internal_issuer" {
  description = "Issuer as reached from inside the VPC by the web tasks."
  value       = local.keycloak_internal_issuer
}

output "google_redirect_uri" {
  description = "Add this exact URI to the Google OAuth client's authorised redirect URIs."
  value       = "${local.keycloak_public_origin}/realms/${var.keycloak_realm}/broker/google/endpoint"
}

output "ecr_web_repository_url" {
  description = "ECR repo for the web image."
  value       = aws_ecr_repository.web.repository_url
}

output "ecr_keycloak_repository_url" {
  description = "ECR repo for the Keycloak image."
  value       = aws_ecr_repository.keycloak.repository_url
}

output "ecr_migrate_repository_url" {
  description = "ECR repo for the migration image."
  value       = aws_ecr_repository.migrate.repository_url
}

output "ecs_cluster_name" {
  value       = aws_ecs_cluster.main.name
  description = "ECS cluster name, used by the deploy workflow."
}

output "ecs_web_service_name" {
  value       = aws_ecs_service.web.name
  description = "Web service name, used by the deploy workflow."
}

output "ecs_worker_service_name" {
  value       = aws_ecs_service.worker.name
  description = "Matching worker service name, used by the deploy workflow."
}

output "worker_task_definition_family" {
  value       = aws_ecs_task_definition.worker.family
  description = "Task definition family for the asynchronous matching worker."
}

output "ecs_keycloak_service_name" {
  value       = aws_ecs_service.keycloak.name
  description = "Keycloak service name."
}

output "migrate_task_definition_family" {
  value       = aws_ecs_task_definition.migrate.family
  description = "Task definition family the deploy workflow runs before rollout."
}

output "private_subnet_ids" {
  value       = aws_subnet.private[*].id
  description = "Subnets the migration task should run in."
}

output "task_security_group_id" {
  value       = aws_security_group.ecs_tasks.id
  description = "Security group the migration task should use."
}

output "github_deploy_role_arn" {
  description = "Role for GitHub Actions to assume. Set as AWS_DEPLOY_ROLE_ARN in repo secrets."
  value       = var.github_repository != "" ? aws_iam_role.github_deploy[0].arn : ""
}

output "database_endpoint" {
  description = "RDS endpoint. Not publicly reachable."
  value       = aws_db_instance.main.address
}

output "secrets_manager_secret_name" {
  description = "Where runtime secrets live. Update GEMINI_API_KEY / RESEND_API_KEY here."
  value       = aws_secretsmanager_secret.app.name
}

output "keycloak_admin_console_url" {
  description = "Keycloak admin console. The bootstrap password is in Secrets Manager."
  value       = "${local.keycloak_public_origin}/admin"
}

output "post_apply_checklist" {
  description = "What still needs doing by hand after the first apply."
  value       = <<-EOT
    1. Create a Google OAuth client and set its authorised redirect URI to:
         ${local.keycloak_public_origin}/realms/${var.keycloak_realm}/broker/google/endpoint
       Then put the id/secret into the ${aws_secretsmanager_secret.app.name} secret
       (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET) and redeploy Keycloak.
    2. Verify your sending domain in Resend and set RESEND_API_KEY in the same secret.
    3. Set GEMINI_API_KEY in the same secret.
    4. Import the attendee roster:  npm run db:import -- attendees.xlsx
    5. If var.domain_name is set, point DNS at ${aws_lb.main.dns_name}.
  EOT
}
