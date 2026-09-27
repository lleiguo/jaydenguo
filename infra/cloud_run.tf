locals {
  web_secret_env = {
    AUTH_SECRET          = "auth-secret"
    GOOGLE_CLIENT_ID     = "google-oauth-client-id"
    GOOGLE_CLIENT_SECRET = "google-oauth-client-secret"
  }

  db_env = {
    INSTANCE_CONNECTION_NAME = google_sql_database_instance.hub.connection_name
    DB_NAME                  = google_sql_database.hub.name
  }
}

resource "google_cloud_run_v2_service" "web" {
  name                = "web"
  location            = var.region
  deletion_protection = false
  ingress             = "INGRESS_TRAFFIC_ALL"

  template {
    service_account = google_service_account.web.email

    scaling {
      min_instance_count = 0 # F-10: start with scale to zero
      max_instance_count = 3
    }

    containers {
      image = var.web_image

      ports {
        container_port = 8080
      }

      resources {
        limits = {
          cpu    = "1"
          memory = "512Mi"
        }
        cpu_idle = true
      }

      dynamic "env" {
        for_each = merge(local.db_env, {
          DB_IAM_USER    = local.web_db_user
          WORKER_JOB     = google_cloud_run_v2_job.worker.id
          KMS_KEY        = google_kms_crypto_key.credentials.id
          APP_URL        = "https://${var.domain}"
          ALLOWED_EMAILS = join(",", var.allowed_emails)
        })
        content {
          name  = env.key
          value = env.value
        }
      }

      # Sign-in secrets (plan M1.1). Each secret needs a version before the
      # first apply that includes this block; see infra/README.md step 7.
      dynamic "env" {
        for_each = local.web_secret_env
        content {
          name = env.key
          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.app[env.value].secret_id
              version = "latest"
            }
          }
        }
      }

      startup_probe {
        http_get {
          path = "/api/healthz"
        }
      }
    }
  }

  lifecycle {
    # Deploys (GitHub Actions) change the image; Terraform owns the rest.
    ignore_changes = [template[0].containers[0].image, client, client_version]
  }

  depends_on = [google_project_service.enabled]
}

# The app does its own sign-in (spec AUTH-1..2), so the service is reachable
# from the internet through Firebase Hosting.
resource "google_cloud_run_v2_service_iam_member" "web_public" {
  name     = google_cloud_run_v2_service.web.name
  location = var.region
  role     = "roles/run.invoker"
  member   = "allUsers"
}

resource "google_cloud_run_v2_job" "worker" {
  name                = "worker"
  location            = var.region
  deletion_protection = false

  template {
    task_count = 1

    template {
      service_account = google_service_account.worker.email
      timeout         = "1800s"
      max_retries     = 0

      containers {
        image = var.worker_image
        args  = ["noop"]

        resources {
          limits = {
            cpu    = "1"
            memory = "2Gi" # Chromium and ffmpeg
          }
        }

        dynamic "env" {
          for_each = merge(local.db_env, {
            DB_IAM_USER = local.worker_db_user
            WEB_DB_USER = local.web_db_user
            KMS_KEY     = google_kms_crypto_key.credentials.id
          })
          content {
            name  = env.key
            value = env.value
          }
        }
      }
    }
  }

  lifecycle {
    ignore_changes = [template[0].template[0].containers[0].image, client, client_version]
  }

  depends_on = [google_project_service.enabled]
}

# The web app starts jobs with per-run arguments (on-demand refresh, SYNC-2).
resource "google_cloud_run_v2_job_iam_member" "web_runs_worker" {
  name     = google_cloud_run_v2_job.worker.name
  location = var.region
  role     = "roles/run.jobsExecutorWithOverrides"
  member   = google_service_account.web.member
}

resource "google_cloud_run_v2_job_iam_member" "scheduler_runs_worker" {
  name     = google_cloud_run_v2_job.worker.name
  location = var.region
  role     = "roles/run.jobsExecutorWithOverrides"
  member   = google_service_account.scheduler.member
}
