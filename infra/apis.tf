locals {
  services = [
    "aiplatform.googleapis.com",
    "artifactregistry.googleapis.com",
    "billingbudgets.googleapis.com",
    "bigquery.googleapis.com",      # reading the billing export (intent 0002)
    "calendar-json.googleapis.com", # household calendar (SRC-1)
    "classroom.googleapis.com",     # homework and grades (SRC-8)
    "cloudkms.googleapis.com",
    "cloudresourcemanager.googleapis.com",
    "cloudscheduler.googleapis.com",
    "drive.googleapis.com", # video reviews from Drive links (VID-2)
    "firebase.googleapis.com",
    "firebasehosting.googleapis.com",
    "gmail.googleapis.com", # coach and club emails (SRC-4)
    "iam.googleapis.com",
    "iamcredentials.googleapis.com",
    "logging.googleapis.com",
    "monitoring.googleapis.com",
    "photospicker.googleapis.com", # video reviews picked in Google Photos (F-4)
    "routes.googleapis.com",       # drive times to tournaments (TEN-9)
    "run.googleapis.com",
    "secretmanager.googleapis.com",
    "sqladmin.googleapis.com",
    "sts.googleapis.com",
    "texttospeech.googleapis.com", # Cookie's spoken answers (intent 0007, VOX-5)
  ]
}

resource "google_project_service" "enabled" {
  for_each           = toset(local.services)
  service            = each.value
  disable_on_destroy = false
}
