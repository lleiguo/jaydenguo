# The Costs page (intent 0002): the worker reads the Cloud Billing export in
# BigQuery, read-only. The export itself is turned on by the owner in the
# Console (only a billing admin can); its dataset is named here once it
# exists.

resource "google_project_iam_member" "worker_bigquery_jobs" {
  count   = var.billing_export_dataset != "" ? 1 : 0
  project = var.project_id
  role    = "roles/bigquery.jobUser"
  member  = google_service_account.worker.member
}

resource "google_bigquery_dataset_iam_member" "worker_billing_reader" {
  count      = var.billing_export_dataset != "" ? 1 : 0
  project    = var.project_id
  dataset_id = var.billing_export_dataset
  role       = "roles/bigquery.dataViewer"
  member     = google_service_account.worker.member
}
