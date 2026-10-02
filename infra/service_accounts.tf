# One identity per component, each with only what it needs.

resource "google_service_account" "web" {
  account_id   = "hub-web"
  display_name = "Hub web service"
}

resource "google_service_account" "worker" {
  account_id   = "hub-worker"
  display_name = "Hub worker jobs"
}

resource "google_service_account" "scheduler" {
  account_id   = "hub-scheduler"
  display_name = "Hub scheduler (starts worker jobs)"
}

resource "google_service_account" "deployer" {
  account_id   = "hub-deployer"
  display_name = "Hub GitHub Actions deployer"
}

locals {
  # Cloud SQL IAM database user names drop the ".gserviceaccount.com" suffix.
  web_db_user    = trimsuffix(google_service_account.web.email, ".gserviceaccount.com")
  worker_db_user = trimsuffix(google_service_account.worker.email, ".gserviceaccount.com")
}

resource "google_project_iam_member" "sql_client" {
  for_each = {
    web    = google_service_account.web.member
    worker = google_service_account.worker.member
  }
  project = var.project_id
  role    = "roles/cloudsql.client"
  member  = each.value
}

resource "google_project_iam_member" "sql_instance_user" {
  for_each = {
    web    = google_service_account.web.member
    worker = google_service_account.worker.member
  }
  project = var.project_id
  role    = "roles/cloudsql.instanceUser"
  member  = each.value
}

# Worker calls Gemini and Claude on Vertex AI (spec §6.3, M5).
resource "google_project_iam_member" "worker_vertex" {
  project = var.project_id
  role    = "roles/aiplatform.user"
  member  = google_service_account.worker.member
}

# Web calls Gemini Flash on Vertex AI for Cookie (intent 0007). Text-to-Speech
# needs no role of its own: the API being enabled is enough.
resource "google_project_iam_member" "web_vertex" {
  project = var.project_id
  role    = "roles/aiplatform.user"
  member  = google_service_account.web.member
}

# Worker calls the Routes API for drive times to tournaments (TEN-9),
# billed to this project through X-Goog-User-Project.
resource "google_project_iam_member" "worker_routes" {
  project = var.project_id
  role    = "roles/serviceusage.serviceUsageConsumer"
  member  = google_service_account.worker.member
}
