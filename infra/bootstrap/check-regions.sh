#!/bin/bash
# Spike SP-1: confirm each service is offered in the chosen Canadian region.
# Usage: infra/bootstrap/check-regions.sh [region]   (needs gcloud, logged in)
set -uo pipefail

REGION="${1:-northamerica-northeast2}"
# Never stop to ask questions (e.g. "enable this API? (y/N)").
export CLOUDSDK_CORE_DISABLE_PROMPTS=1
fail=0

# GNU timeout isn't on macOS by default (Homebrew coreutils calls it gtimeout).
if command -v timeout >/dev/null 2>&1; then
  TIMEOUT=(timeout 60)
elif command -v gtimeout >/dev/null 2>&1; then
  TIMEOUT=(gtimeout 60)
else
  TIMEOUT=()
fi

check() {
  local name="$1"; shift
  local out
  if ! out=$(${TIMEOUT[@]+"${TIMEOUT[@]}"} "$@" 2>&1); then
    printf '  ERROR    %s: %s\n' "$name" "$(echo "$out" | grep -m1 -iE 'error|denied|not enabled' || echo "$out" | tail -n 1)"
    fail=1
  elif echo "$out" | grep -qx "$REGION"; then
    printf '  ok       %s\n' "$name"
  else
    printf '  MISSING  %s\n' "$name"
    fail=1
  fi
}

echo "Project: $(gcloud config get-value project 2>/dev/null)"
echo "Checking ${REGION}:"
check "Cloud Run"                    gcloud run regions list --format='value(locationId)'
check "Artifact Registry"            gcloud artifacts locations list --format='value(name)'
check "Cloud KMS"                    gcloud kms locations list --format='value(locationId)'
check "Cloud Scheduler"              gcloud scheduler locations list --format='value(locationId)'
check "Compute (Cloud SQL, Storage)" gcloud compute regions list --format='value(name)'

echo
echo "ERROR usually means that API isn't enabled yet. Run this after"
echo "'terraform apply' (which enables them), or enable it in the console."
echo "Not checked here: Vertex AI models (spike SP-6, M5) and Firebase Hosting"
echo "rewrites to Cloud Run in ${REGION}."
echo "terraform apply fails on google_firebase_hosting_version if unsupported (see F-14)."
exit $fail
