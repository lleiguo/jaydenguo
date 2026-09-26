# Secret containers only. Values are added by the owner with
# `gcloud secrets versions add` so they never appear in Terraform state.
locals {
  secrets = {
    "auth-secret"                = [google_service_account.web.member]
    "google-oauth-client-id"     = [google_service_account.web.member, google_service_account.worker.member]
    "google-oauth-client-secret" = [google_service_account.web.member, google_service_account.worker.member]
  }
  secret_access = merge([
    for name, members in local.secrets : { for m in members : "${name}|${m}" => { name = name, member = m } }
  ]...)
}

resource "google_secret_manager_secret" "app" {
  for_each  = local.secrets
  secret_id = each.key

  replication {
    user_managed {
      replicas {
        location = var.region
      }
    }
  }

  depends_on = [google_project_service.enabled]
}

resource "google_secret_manager_secret_iam_member" "access" {
  for_each  = local.secret_access
  secret_id = google_secret_manager_secret.app[each.value.name].id
  role      = "roles/secretmanager.secretAccessor"
  member    = each.value.member
}
