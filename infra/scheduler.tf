# Daily triggers (plan M1.5 and M1.13, spec SYNC-1, NFR-3). Cloud Scheduler starts an
# execution of the worker job with the job name as an argument override,
# using the Cloud Run Admin API. The scheduler stores no personal data.
locals {
  scheduler_region = var.scheduler_region != "" ? var.scheduler_region : var.region
  worker_run_uri   = "https://run.googleapis.com/v2/${google_cloud_run_v2_job.worker.id}:run"

  daily_jobs = {
    "daily-sync" = {
      description = "Sync every enabled source (SYNC-1)"
      schedule    = var.daily_sync_schedule
      args        = ["sync", "all", "scheduled"]
    }
    "nightly-backup" = {
      description = "Export the database to the backup bucket (NFR-3)"
      schedule    = var.daily_backup_schedule
      args        = ["backup"]
    }
  }
}

resource "google_cloud_scheduler_job" "daily" {
  for_each    = local.daily_jobs
  name        = each.key
  description = each.value.description
  region      = local.scheduler_region
  schedule    = each.value.schedule
  time_zone   = var.home_time_zone

  retry_config {
    retry_count = 1
  }

  http_target {
    http_method = "POST"
    uri         = local.worker_run_uri
    headers     = { "Content-Type" = "application/json" }
    body = base64encode(jsonencode({
      overrides = { containerOverrides = [{ args = each.value.args }] }
    }))

    oauth_token {
      service_account_email = google_service_account.scheduler.email
      scope                 = "https://www.googleapis.com/auth/cloud-platform"
    }
  }

  depends_on = [google_project_service.enabled]
}
