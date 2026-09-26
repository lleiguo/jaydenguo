resource "google_sql_database_instance" "hub" {
  name                = "hub"
  database_version    = "POSTGRES_16"
  region              = var.region
  deletion_protection = true

  settings {
    edition           = "ENTERPRISE"
    tier              = var.sql_tier
    availability_type = "ZONAL"
    disk_type         = "PD_SSD"
    disk_size         = 10
    disk_autoresize   = true

    backup_configuration {
      enabled                        = true
      point_in_time_recovery_enabled = true
      transaction_log_retention_days = 7
      # Keep backups in Canada (NFR-1a); the default is a multi-region.
      location = var.region
      backup_retention_settings {
        retained_backups = 14
      }
    }

    ip_configuration {
      # Public IP with no authorised networks: only the Cloud SQL connector
      # (IAM-authenticated, TLS) can reach it. No VPC connector cost.
      ipv4_enabled = true
      ssl_mode     = "ENCRYPTED_ONLY"
    }

    database_flags {
      name  = "cloudsql.iam_authentication"
      value = "on"
    }

    maintenance_window {
      day  = 7
      hour = 8 # UTC, i.e. early Sunday morning in Toronto
    }
  }

  depends_on = [google_project_service.enabled]
}

resource "google_sql_database" "hub" {
  name     = "hub"
  instance = google_sql_database_instance.hub.name
}

# Passwordless database users backed by the service accounts.
resource "google_sql_user" "web" {
  name     = local.web_db_user
  instance = google_sql_database_instance.hub.name
  type     = "CLOUD_IAM_SERVICE_ACCOUNT"
}

resource "google_sql_user" "worker" {
  name     = local.worker_db_user
  instance = google_sql_database_instance.hub.name
  type     = "CLOUD_IAM_SERVICE_ACCOUNT"
}
