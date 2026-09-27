terraform {
  required_version = ">= 1.6"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 8.4"
    }
    google-beta = {
      source  = "hashicorp/google-beta"
      version = "~> 8.4"
    }
  }

  # State lives in a bucket created by bootstrap.sh (see README).
  # terraform init -backend-config="bucket=<project>-tfstate"
  backend "gcs" {
    prefix = "hub"
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
  # Bill API quota to this project. Required by APIs such as Billing Budgets
  # when Terraform runs with a person's own gcloud credentials.
  user_project_override = true
  billing_project       = var.project_id
}

provider "google-beta" {
  project = var.project_id
  region  = var.region
  # Bill API quota to this project. Required by APIs such as Billing Budgets
  # when Terraform runs with a person's own gcloud credentials.
  user_project_override = true
  billing_project       = var.project_id
}
