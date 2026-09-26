#!/bin/bash
# Spike SP-1: confirm each service is offered in the chosen Canadian region.
# Usage: infra/bootstrap/check-regions.sh [region]   (needs gcloud, logged in)
set -uo pipefail

REGION="${1:-northamerica-northeast2}"
fail=0

check() {
  local name="$1"; shift
  if "$@" 2>/dev/null | grep -qx "$REGION"; then
    printf '  ok   %s\n' "$name"
  else
    printf '  MISSING  %s\n' "$name"; fail=1
  fi
}

echo "Checking ${REGION}:"
check "Cloud Run"         gcloud run regions list --format='value(locationId)'
check "Artifact Registry" gcloud artifacts locations list --format='value(name)'
check "Cloud KMS"         gcloud kms locations list --format='value(locationId)'
check "Cloud Scheduler"   gcloud scheduler locations list --format='value(locationId)'
check "Compute (Cloud SQL, Storage)" gcloud compute regions list --format='value(name)'

echo
echo "Not checked here: Vertex AI models (spike SP-6, M5) and Firebase Hosting"
echo "rewrites to Cloud Run in ${REGION}."
echo "terraform apply fails on google_firebase_hosting_version if unsupported (see F-14)."
exit $fail
