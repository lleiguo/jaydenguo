# SYNC-4: three sync failures in a row email the owner. The worker logs a
# line with `alert = "sync_failed_repeatedly"` (src/worker/sync.ts); a
# log-match alert policy turns it into an email. No mail service or extra
# Google scopes are needed.
locals {
  alert_email = var.alert_email != "" ? var.alert_email : var.allowed_emails[0]
}

resource "google_monitoring_notification_channel" "owner_email" {
  display_name = "Site owner"
  type         = "email"
  labels = {
    email_address = local.alert_email
  }

  depends_on = [google_project_service.enabled]
}

resource "google_monitoring_alert_policy" "sync_failing" {
  display_name = "A source failed to sync 3 times in a row"
  combiner     = "OR"

  conditions {
    display_name = "sync_failed_repeatedly log line"
    condition_matched_log {
      filter = "resource.type=\"cloud_run_job\" AND jsonPayload.alert=\"sync_failed_repeatedly\""
      label_extractors = {
        source = "EXTRACT(jsonPayload.source)"
      }
    }
  }

  alert_strategy {
    notification_rate_limit {
      period = "3600s"
    }
    auto_close = "86400s"
  }

  documentation {
    content   = "A source has failed three syncs in a row. Open https://${var.domain}/sources to see which one and why."
    mime_type = "text/markdown"
  }

  notification_channels = [google_monitoring_notification_channel.owner_email.id]
}

# NFR-3: a failed nightly export emails the owner.
resource "google_monitoring_alert_policy" "backup_failed" {
  display_name = "The nightly database backup failed"
  combiner     = "OR"

  conditions {
    display_name = "backup job failed"
    condition_matched_log {
      filter = "resource.type=\"cloud_run_job\" AND jsonPayload.message=\"job failed\" AND jsonPayload.job=\"backup\""
    }
  }

  alert_strategy {
    notification_rate_limit {
      period = "3600s"
    }
    auto_close = "86400s"
  }

  documentation {
    content   = "Last night's export didn't finish. See the worker job's logs in Cloud Run, then run it by hand: gcloud run jobs execute worker --region ${var.region} --args=backup"
    mime_type = "text/markdown"
  }

  notification_channels = [google_monitoring_notification_channel.owner_email.id]
}
