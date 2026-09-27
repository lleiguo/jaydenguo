# Nightly database exports, kept for a year (spec NFR-3). The retention
# policy stops any object being deleted or overwritten before it is a year
# old. It is not locked; locking is irreversible and left to the owner.
resource "google_storage_bucket" "backups" {
  name                        = "${var.project_id}-backups"
  location                    = var.region
  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"
  storage_class               = "STANDARD"

  retention_policy {
    retention_period = 31536000 # 365 days
  }

  lifecycle_rule {
    condition {
      age = 400
    }
    action {
      type = "Delete"
    }
  }
}

# Cloud SQL writes exports with its own service agent.
resource "google_storage_bucket_iam_member" "sql_export" {
  bucket = google_storage_bucket.backups.name
  role   = "roles/storage.objectCreator"
  member = "serviceAccount:${google_sql_database_instance.hub.service_account_email_address}"
}

# The worker's nightly `backup` job asks Cloud SQL to export (plan M1.13).
# A custom role keeps this to exactly the permissions it needs.
resource "google_project_iam_custom_role" "sql_exporter" {
  role_id     = "hubSqlExporter"
  title       = "Hub SQL exporter"
  description = "Start Cloud SQL exports and read their progress."
  permissions = ["cloudsql.instances.export", "cloudsql.instances.get"]
}

resource "google_project_iam_member" "worker_sql_export" {
  project = var.project_id
  role    = google_project_iam_custom_role.sql_exporter.id
  member  = google_service_account.worker.member
}
