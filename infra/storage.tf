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
