# Keep logs in Canada (spec NFR-1a). The project's _Default bucket is global,
# so logs are routed to a regional bucket and the _Default sink is disabled.
# The _Required bucket (admin audit logs, no personal data) cannot be moved.
resource "google_logging_project_bucket_config" "regional" {
  project        = var.project_id
  location       = var.region
  bucket_id      = "hub-logs"
  retention_days = 30
}

resource "google_logging_project_sink" "regional" {
  name                   = "hub-regional"
  destination            = "logging.googleapis.com/${google_logging_project_bucket_config.regional.id}"
  filter                 = "NOT LOG_ID(\"cloudaudit.googleapis.com/activity\") AND NOT LOG_ID(\"externalaudit.googleapis.com/activity\") AND NOT LOG_ID(\"cloudaudit.googleapis.com/system_event\") AND NOT LOG_ID(\"externalaudit.googleapis.com/system_event\") AND NOT LOG_ID(\"cloudaudit.googleapis.com/access_transparency\") AND NOT LOG_ID(\"externalaudit.googleapis.com/access_transparency\")"
  unique_writer_identity = true
}

import {
  to = google_logging_project_sink.default
  id = "projects/${var.project_id}/sinks/_Default"
}

resource "google_logging_project_sink" "default" {
  name        = "_Default"
  destination = "logging.googleapis.com/projects/${var.project_id}/locations/global/buckets/_Default"
  disabled    = true
}
