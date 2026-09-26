data "google_project" "this" {}

# One alert budget for the whole project (spec NFR-7). A separate AI budget
# is added in M5 once the Vertex AI billing service is confirmed (SP-6).
resource "google_billing_budget" "project" {
  billing_account = var.billing_account_id
  display_name    = "hub monthly"

  budget_filter {
    projects = ["projects/${data.google_project.this.number}"]
  }

  amount {
    specified_amount {
      currency_code = var.budget_currency
      units         = tostring(var.monthly_budget)
    }
  }

  threshold_rules {
    threshold_percent = 0.5
  }
  threshold_rules {
    threshold_percent = 0.9
  }
  threshold_rules {
    threshold_percent = 1.0
  }
  threshold_rules {
    threshold_percent = 1.0
    spend_basis       = "FORECASTED_SPEND"
  }

  depends_on = [google_project_service.enabled]
}
