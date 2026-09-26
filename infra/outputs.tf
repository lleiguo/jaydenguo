output "registry" {
  description = "Artifact Registry path for images (GitHub variable GCP_REGISTRY)."
  value       = local.registry
}

output "workload_identity_provider" {
  description = "GitHub variable GCP_WIF_PROVIDER."
  value       = google_iam_workload_identity_pool_provider.github.name
}

output "deployer_service_account" {
  description = "GitHub variable GCP_DEPLOYER_SA."
  value       = google_service_account.deployer.email
}

output "web_url" {
  value = google_cloud_run_v2_service.web.uri
}

output "sql_connection_name" {
  value = google_sql_database_instance.hub.connection_name
}

output "db_users" {
  description = "IAM database users; used by the one-time grants in bootstrap/db-grants.sql."
  value       = { web = local.web_db_user, worker = local.worker_db_user }
}

output "dns_records" {
  description = "Records to add at the domain registrar for Firebase Hosting."
  value = {
    apex = google_firebase_hosting_custom_domain.apex.required_dns_updates
    www  = google_firebase_hosting_custom_domain.www.required_dns_updates
  }
}
