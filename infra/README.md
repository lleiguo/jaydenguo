# Infrastructure (Google Cloud, Canada)

Everything the site runs on is defined here with Terraform (plan M0.6). All
resources are in `northamerica-northeast2` (Toronto); Montréal is the only
allowed fallback (spec F-11, NFR-1a).

| File                   | What it creates                                                                                       |
| ---------------------- | ----------------------------------------------------------------------------------------------------- |
| `apis.tf`              | Enables the Google Cloud APIs used                                                                    |
| `service_accounts.tf`  | `hub-web`, `hub-worker`, `hub-scheduler`, `hub-deployer` and their project roles                      |
| `sql.tf`               | Cloud SQL for PostgreSQL 16, backups + 7-day point-in-time restore in Canada, IAM-only database users |
| `kms.tf`               | Key for stored credentials: web can only encrypt, worker can only decrypt                             |
| `secrets.tf`           | Secret Manager containers (values are added by hand, never in Terraform state)                        |
| `artifact_registry.tf` | Docker repository for the web and worker images                                                       |
| `cloud_run.tf`         | `web` service (scale to zero) and `worker` job                                                        |
| `storage.tf`           | Backup bucket with a 1-year retention policy                                                          |
| `logging.tf`           | Regional log bucket; the global `_Default` sink is disabled                                           |
| `budget.tf`            | Monthly budget alert at 50/90/100%                                                                    |
| `firebase.tf`          | Firebase Hosting in front of Cloud Run, custom domain and TLS                                         |
| `github_deploy.tf`     | Workload Identity Federation so GitHub Actions deploys without keys                                   |

## First-time setup (owner)

1. Create a Google Cloud project and link a billing account (console).
2. Install the gcloud CLI and Terraform, then sign in:
   `gcloud auth login && gcloud auth application-default login`
3. Create the Terraform state bucket:
   `infra/bootstrap/bootstrap.sh <project-id>`
4. Check that every service is offered in Toronto (spike SP-1):
   `infra/bootstrap/check-regions.sh`. APIs that aren't enabled yet show as
   `ERROR`; that's expected before step 6. Re-run it after `terraform apply`
   for the full result.
5. Fill in variables: `cp infra/example.tfvars infra/prod.tfvars` and edit.
6. Apply:
   ```bash
   cd infra
   terraform init -backend-config="bucket=<project-id>-tfstate"
   terraform apply -var-file=prod.tfvars
   ```
   Commit the generated `.terraform.lock.hcl` after the first real init.

   If the budget fails with a 403 about a "quota project", your local
   credentials are billing API calls to Google's gcloud project. Either run
   `gcloud auth application-default login --project <project-id>`, or set
   `create_budget = false` in `prod.tfvars` and create the budget in the
   Console (Billing → Budgets & alerts: this project, alerts at 50/90/100%).
7. Add secret values (never paste them anywhere else):
   ```bash
   openssl rand -base64 48 | gcloud secrets versions add auth-secret --data-file=-
   ```
   The Google OAuth client ID and secret are added in M1.
8. One-time database grants: set a password for the built-in `postgres`
   user (`gcloud sql users set-password postgres --instance hub --prompt-for-password`),
   open Cloud SQL Studio, and run `bootstrap/db-grants.sql` with the names
   from `terraform output db_users`.
9. DNS: add the records from `terraform output dns_records` at the registrar
   for `jaydenguo.com`. The certificate is issued once DNS verifies.
10. GitHub → Settings → Variables → Actions: set `GCP_PROJECT_ID`,
    `GCP_REGION`, and from `terraform output`: `GCP_REGISTRY`,
    `GCP_WIF_PROVIDER`, `GCP_DEPLOYER_SA`.
11. Merge to `main`. The Deploy workflow builds both images, runs the
    `migrate` job and deploys `web`.

## Day to day

- Code deploys go through GitHub Actions only. Terraform ignores image changes.
- Infrastructure changes: edit here, `terraform plan`, review, `terraform apply`.
- Run a worker job by hand: `gcloud run jobs execute worker --region northamerica-northeast2 --args=<job>`.
