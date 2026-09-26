#!/bin/bash
# One-time setup before the first `terraform apply` (plan O-1).
# Usage: infra/bootstrap/bootstrap.sh <project-id> [region]
set -euo pipefail

PROJECT="${1:?project id required}"
REGION="${2:-northamerica-northeast2}"
BUCKET="${PROJECT}-tfstate"

gcloud config set project "$PROJECT"
gcloud services enable serviceusage.googleapis.com cloudresourcemanager.googleapis.com storage.googleapis.com

# Terraform state bucket, in Canada, versioned, never public.
if ! gcloud storage buckets describe "gs://${BUCKET}" >/dev/null 2>&1; then
  gcloud storage buckets create "gs://${BUCKET}" \
    --location="$REGION" \
    --uniform-bucket-level-access \
    --public-access-prevention
fi
gcloud storage buckets update "gs://${BUCKET}" --versioning

echo "State bucket ready: ${BUCKET}"
echo "Next: cd infra && terraform init -backend-config=\"bucket=${BUCKET}\""
