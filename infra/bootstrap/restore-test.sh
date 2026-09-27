#!/usr/bin/env bash
# Restore test (plan M1.13, spec NFR-3): import the newest nightly export
# into a throwaway Cloud SQL instance, so row counts can be compared with
# production. Run by the owner; see infra/README.md "Backups and restore".
#
#   infra/bootstrap/restore-test.sh <project-id> [region]
#   infra/bootstrap/restore-test.sh <project-id> [region] --delete   # clean up
set -euo pipefail

PROJECT="${1:?project id}"
REGION="${2:-northamerica-northeast2}"
SCRATCH="hub-restore-test"
BUCKET="${PROJECT}-backups"

if [[ "${3:-}" == "--delete" ]]; then
  gcloud sql instances delete "$SCRATCH" --project "$PROJECT" --quiet
  exit 0
fi

LATEST=$(gcloud storage ls "gs://${BUCKET}/sql/" --project "$PROJECT" | sort | tail -1)
[[ -n "$LATEST" ]] || { echo "No exports found in gs://${BUCKET}/sql/"; exit 1; }
echo "Newest export: $LATEST"

if ! gcloud sql instances describe "$SCRATCH" --project "$PROJECT" >/dev/null 2>&1; then
  # Smallest size, no backups; public IP with no authorised networks, like
  # production. It lives only for this test.
  gcloud sql instances create "$SCRATCH" --project "$PROJECT" --region "$REGION" \
    --database-version POSTGRES_16 --edition ENTERPRISE --tier db-f1-micro \
    --storage-size 10 --no-backup --database-flags cloudsql.iam_authentication=on
fi
gcloud sql databases create hub --instance "$SCRATCH" --project "$PROJECT" 2>/dev/null || true

# The export refers to the IAM database users (table owners, grants), so
# the scratch instance needs the same users.
for user in $(gcloud sql users list --instance hub --project "$PROJECT" \
  --filter 'type=CLOUD_IAM_SERVICE_ACCOUNT' --format 'value(name)'); do
  gcloud sql users create "${user}.gserviceaccount.com" --instance "$SCRATCH" --project "$PROJECT" \
    --type cloud_iam_service_account 2>/dev/null || true
done

# The scratch instance's service agent needs to read the export.
SA=$(gcloud sql instances describe "$SCRATCH" --project "$PROJECT" --format 'value(serviceAccountEmailAddress)')
gcloud storage buckets add-iam-policy-binding "gs://${BUCKET}" --project "$PROJECT" \
  --member "serviceAccount:${SA}" --role roles/storage.objectViewer >/dev/null

gcloud sql import sql "$SCRATCH" "$LATEST" --database hub --project "$PROJECT" --quiet

cat <<MSG

Imported. Now compare row counts: open Cloud SQL Studio for both "hub" and
"${SCRATCH}" (database hub) and run the query in infra/README.md
("Backups and restore"). Then delete the scratch instance:

  infra/bootstrap/restore-test.sh ${PROJECT} ${REGION} --delete
MSG
