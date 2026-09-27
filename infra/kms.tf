# Key-encryption key for stored credentials (spec §7.3, CRED-3).
resource "google_kms_key_ring" "hub" {
  name     = "hub"
  location = var.region

  depends_on = [google_project_service.enabled]
}

resource "google_kms_crypto_key" "credentials" {
  name            = "credentials"
  key_ring        = google_kms_key_ring.hub.id
  rotation_period = "7776000s" # 90 days; old versions stay available for decrypt

  lifecycle {
    prevent_destroy = true
  }
}

# The web service can wrap new data keys but never unwrap them (CRED-4).
resource "google_kms_crypto_key_iam_member" "web_encrypt" {
  crypto_key_id = google_kms_crypto_key.credentials.id
  role          = "roles/cloudkms.cryptoKeyEncrypter"
  member        = google_service_account.web.member
}

# The worker also encrypts, only to re-wrap data keys during rotation
# (`rotate-keys` job, plan M1.2). The web service still can't decrypt.
resource "google_kms_crypto_key_iam_member" "worker_encrypt" {
  crypto_key_id = google_kms_crypto_key.credentials.id
  role          = "roles/cloudkms.cryptoKeyEncrypter"
  member        = google_service_account.worker.member
}

resource "google_kms_crypto_key_iam_member" "worker_decrypt" {
  crypto_key_id = google_kms_crypto_key.credentials.id
  role          = "roles/cloudkms.cryptoKeyDecrypter"
  member        = google_service_account.worker.member
}
