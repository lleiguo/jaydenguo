variable "project_id" {
  description = "Google Cloud project ID."
  type        = string
}

variable "region" {
  description = "All resources live here. Data must stay in Canada (spec NFR-1a)."
  type        = string
  default     = "northamerica-northeast2"

  validation {
    condition     = contains(["northamerica-northeast2", "northamerica-northeast1"], var.region)
    error_message = "Region must be Toronto (northamerica-northeast2) or Montréal (northamerica-northeast1)."
  }
}

variable "domain" {
  description = "Public domain for the site."
  type        = string
  default     = "jaydenguo.com"
}

variable "github_repository" {
  description = "owner/name of the GitHub repo allowed to deploy."
  type        = string
  default     = "lleiguo/jaydenguo"
}

variable "billing_account_id" {
  description = "Billing account for the budget alert (e.g. 012345-6789AB-CDEF01)."
  type        = string
}

variable "monthly_budget" {
  description = "Monthly alert budget for the whole project (infrastructure + AI)."
  type        = number
  default     = 80
}

variable "budget_currency" {
  description = "Must match the billing account's currency (e.g. USD or CAD)."
  type        = string
  default     = "USD"
}

variable "sql_tier" {
  description = "Cloud SQL machine tier. Smallest shared-core by default."
  type        = string
  default     = "db-f1-micro"
}

variable "web_image" {
  description = "Initial web image. Deploys replace it; Terraform ignores later changes."
  type        = string
  default     = "us-docker.pkg.dev/cloudrun/container/hello"
}

variable "worker_image" {
  description = "Initial worker image. Deploys replace it; Terraform ignores later changes."
  type        = string
  default     = "us-docker.pkg.dev/cloudrun/container/job"
}
