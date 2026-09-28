data "google_project" "this" {}

# Two alert budgets (spec NFR-7): one for the whole project, and one for AI
# alone, filtered on the billing services that charge for Gemini and Claude
# on Vertex AI (plan M5.1, spikes.md SP-6).
resource "google_billing_budget" "project" {
  count           = var.create_budget ? 1 : 0
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

  lifecycle {
    precondition {
      condition     = var.billing_account_id != ""
      error_message = "Set billing_account_id, or set create_budget = false."
    }
  }

  depends_on = [google_project_service.enabled]
}

resource "google_billing_budget" "ai" {
  count           = var.create_budget ? 1 : 0
  billing_account = var.billing_account_id
  display_name    = "hub AI monthly"

  budget_filter {
    projects = ["projects/${data.google_project.this.number}"]
    services = [for id in var.ai_billing_services : "services/${id}"]
  }

  amount {
    specified_amount {
      currency_code = var.budget_currency
      units         = tostring(var.ai_monthly_budget)
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

  lifecycle {
    precondition {
      condition     = var.billing_account_id != ""
      error_message = "Set billing_account_id, or set create_budget = false."
    }
  }

  depends_on = [google_project_service.enabled]
}
