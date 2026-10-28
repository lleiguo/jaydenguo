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

variable "allowed_emails" {
  description = "Google accounts allowed to sign in (spec AUTH-1): the owner only."
  type        = list(string)
  default     = ["lleiguo@gmail.com"]
}

variable "github_repository" {
  description = "owner/name of the GitHub repo allowed to deploy."
  type        = string
  default     = "lleiguo/jaydenguo"
}

variable "create_budget" {
  description = "Create the budget alert with Terraform. Set false to create it in the Console instead."
  type        = bool
  default     = true
}

variable "billing_account_id" {
  description = "Billing account for the budget alert (e.g. 012345-6789AB-CDEF01). Unused when create_budget is false."
  type        = string
  default     = ""
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

variable "home_time_zone" {
  description = "Home time zone (spec CAL-9, O-4), e.g. America/Toronto. Set in prod.tfvars; the daily sync runs early morning here."
  type        = string
}

variable "daily_sync_schedule" {
  description = "Cron schedule for the daily sync of every source, in home_time_zone (SYNC-1)."
  type        = string
  default     = "0 5 * * *"
}

variable "tennis_enter_schedule" {
  description = "Cron schedule for finding and entering tournaments (TEN-9), in home_time_zone. Entries open Thursday mornings."
  type        = string
  default     = "0 12 * * 4"
}

variable "tennis_acceptance_schedule" {
  description = "Cron schedule for reading acceptance lists (TEN-10), in home_time_zone. Lists come out on Fridays, often after 10:00: read every 2 hours until he's settled (intent 0017, ACC-2)."
  type        = string
  default     = "0 8-20/2 * * 5"
}

variable "tennis_draw_watch_schedule" {
  description = "Cron schedule for the hourly draw watch (TEN-11), in home_time_zone. Draws come out Monday; Tuesday and Wednesday catch late ones. Runs with nothing to watch make no requests."
  type        = string
  default     = "0 7-21 * * 1-3"
}

variable "household_sync_day_schedule" {
  description = "Cron schedule for reading the household calendar in the day (intent 0020, BACK-1: every 15 minutes, 06:00 to 22:00), in home_time_zone. Runs while two-way sync is off read nothing."
  type        = string
  default     = "*/15 6-21 * * *"
}

variable "household_sync_night_schedule" {
  description = "Cron schedule for reading the household calendar at night (intent 0020, BACK-1: hourly), in home_time_zone."
  type        = string
  default     = "0 22-23,0-5 * * *"
}

variable "leave_check_schedule" {
  description = "Cron schedule for Time to leave (intent 0027, TRF-R3), in home_time_zone: every 5 minutes, 06:00 to 21:55."
  type        = string
  default     = "*/5 6-21 * * *"
}

variable "mail_digest_schedule" {
  description = "Cron schedule for today's mail and its morning notification (intent 0025, MD-1, MA-4), in home_time_zone."
  type        = string
  default     = "30 6 * * *"
}

variable "daily_backup_schedule" {
  description = "Cron schedule for the nightly database export (NFR-3), in home_time_zone."
  type        = string
  default     = "30 3 * * *"
}

variable "scheduler_region" {
  description = "Cloud Scheduler region. Empty means var.region; Montréal is the fallback if Toronto isn't offered (F-11)."
  type        = string
  default     = ""
}

variable "alert_email" {
  description = "Where sync-failure alerts go (SYNC-4). Empty means the first allowed email."
  type        = string
  default     = ""
}

variable "claude_region" {
  description = "Vertex AI location for Claude calls (plan M3.6). \"global\" lets Google route the call; the owner accepted processing outside Canada (nothing is stored there)."
  type        = string
  default     = "global"
}

variable "ai_monthly_budget" {
  description = "Monthly alert budget for AI alone: video reviews, email suggestions, match explanations (spec §8: about $20-35)."
  type        = number
  default     = 40
}

variable "ai_billing_services" {
  description = "Billing service IDs the AI budget watches. C7E2-9256-1C43 is Vertex AI (Gemini). If Claude's charges show under another service on the bill (Billing > Reports, group by service), add its ID here (spikes.md SP-6)."
  type        = list(string)
  default     = ["C7E2-9256-1C43"]
}

variable "gemini_model" {
  description = "Gemini model for video reviews (SP-6: the newest Pro model on Vertex AI in 2026-09 was a preview)."
  type        = string
  default     = "gemini-3.1-pro-preview"
}

variable "gemini_region" {
  description = "Vertex AI location for Gemini calls. Preview models are served from \"global\" only."
  type        = string
  default     = "global"
}

variable "assistant_model" {
  description = "Gemini model for Cookie, the family assistant (intent 0007, SP-C2). Served from gemini_region."
  type        = string
  default     = "gemini-3.8-flash"
}

variable "assistant_voice" {
  description = "Cookie's Text-to-Speech voice: a Chirp 3 HD speaker name (intent 0007, SP-C3)."
  type        = string
  default     = "Leda"
}

variable "assistant_monthly_cap_usd" {
  description = "What Cookie may cost in a month, in US dollars, until Settings → Cookie says otherwise (intent 0007, LIM-5)."
  type        = number
  default     = 10
}

variable "billing_export_dataset" {
  description = "BigQuery dataset (in this project) that receives the Cloud Billing standard usage cost export, e.g. \"billing\". Empty until the owner turns the export on (intent 0002)."
  type        = string
  default     = ""
}

variable "billing_export_table" {
  description = "The export's table as project.dataset.table (gcp_billing_export_v1_<account>), once it exists. Empty hides the bill on the Costs page."
  type        = string
  default     = ""
}

variable "costs_sync_schedule" {
  description = "When the worker reads the billing export (cron, home time zone)."
  type        = string
  default     = "30 6 * * *"
}

variable "apns_key_id" {
  description = "The APNs key's ID (intent 0004, PUSH-6). Empty until the key's secret has a version; pushes are only logged until then."
  type        = string
  default     = ""
}

variable "apns_team_id" {
  description = "The Apple Developer team ID that owns the APNs key."
  type        = string
  default     = ""
}
