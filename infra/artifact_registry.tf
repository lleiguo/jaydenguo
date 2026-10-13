# Storage was the project's biggest cost (intent 0016): about 11 deploys a
# day, each a new web and worker image. Keep a week, and always the last 10
# of each image so a rollback and the running revisions stay pullable.
# Deploys push plain images (no attestation), so one deploy is one version.
resource "google_artifact_registry_repository" "hub" {
  repository_id = "hub"
  location      = var.region
  format        = "DOCKER"

  cleanup_policies {
    id     = "keep-recent"
    action = "KEEP"
    most_recent_versions {
      keep_count = 10
    }
  }

  cleanup_policies {
    id     = "delete-old"
    action = "DELETE"
    condition {
      older_than = "604800s" # 7 days
    }
  }

  depends_on = [google_project_service.enabled]
}

locals {
  registry = "${var.region}-docker.pkg.dev/${var.project_id}/${google_artifact_registry_repository.hub.repository_id}"
}
