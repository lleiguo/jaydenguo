# jaydenguo.com -> Firebase Hosting (managed TLS) -> Cloud Run "web".
# No load balancer to pay for (spec §5). See F-14 about cookies.
resource "google_firebase_project" "this" {
  provider = google-beta
  project  = var.project_id

  depends_on = [google_project_service.enabled]
}

resource "google_firebase_hosting_site" "hub" {
  provider = google-beta
  project  = var.project_id
  site_id  = var.project_id

  depends_on = [google_firebase_project.this]
}

resource "google_firebase_hosting_version" "hub" {
  provider = google-beta
  site_id  = google_firebase_hosting_site.hub.site_id

  config {
    rewrites {
      glob = "**"
      run {
        service_id = google_cloud_run_v2_service.web.name
        region     = var.region
      }
    }
  }
}

resource "google_firebase_hosting_release" "hub" {
  provider     = google-beta
  site_id      = google_firebase_hosting_site.hub.site_id
  version_name = google_firebase_hosting_version.hub.name
  message      = "Route all requests to Cloud Run"
}

resource "google_firebase_hosting_custom_domain" "apex" {
  provider              = google-beta
  project               = var.project_id
  site_id               = google_firebase_hosting_site.hub.site_id
  custom_domain         = var.domain
  wait_dns_verification = false
}

resource "google_firebase_hosting_custom_domain" "www" {
  provider              = google-beta
  project               = var.project_id
  site_id               = google_firebase_hosting_site.hub.site_id
  custom_domain         = "www.${var.domain}"
  redirect_target       = var.domain
  wait_dns_verification = false
}
