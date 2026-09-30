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
| `scheduler.tf`         | Daily Cloud Scheduler trigger that runs `sync all` early morning in the home time zone                |
| `alerts.tf`            | Email to the owner when a source fails to sync three times in a row                                   |
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
   The Google OAuth client ID and secret are added in "Google sign-in"
   below (M1, O-3). Do that before the next `terraform apply`: Cloud Run
   refuses to start a revision whose secrets have no version.
8. One-time database grants: set a password for the built-in `postgres`
   user (`gcloud sql users set-password postgres --instance hub --prompt-for-password`),
   open Cloud SQL Studio, and run `bootstrap/db-grants.sql` with the names
   from `terraform output db_users`.
9. DNS: add the records from `terraform output dns_records` at the registrar
   for `jaydenguo.com`. The certificate is issued once DNS verifies.
10. GitHub → Settings → Secrets and variables → Actions → **Variables**:

    | Variable           | Value                                              |
    | ------------------ | -------------------------------------------------- |
    | `GCP_PROJECT_ID`   | the project ID                                     |
    | `GCP_REGION`       | `northamerica-northeast2`                          |
    | `GCP_REGISTRY`     | `terraform output -raw registry`                   |
    | `GCP_WIF_PROVIDER` | `terraform output -raw workload_identity_provider` |
    | `GCP_DEPLOYER_SA`  | `terraform output -raw deployer_service_account`   |

    zsh prints a `%` after `-raw` output that has no trailing newline. It is
    not part of the value; don't copy it.

11. Actions → Deploy → **Run workflow** on `main` (later deploys run
    automatically after CI passes on `main`). It builds both images, runs
    the `migrate` job and deploys `web`.

## Google sign-in (M1, owner task O-3)

The site signs in with Google (spec AUTH-1) and later reads the household
calendar with the same Google app. Do this once, in the Google Cloud console
for the `jaydenguo` project (<https://console.cloud.google.com>, project
picker at the top).

1. **Consent screen.** Menu → **APIs & Services** → **OAuth consent screen**
   (it opens **Google Auth Platform**). Click **Get started**.
   - App name: `Family hub` (keep it neutral; nothing about Jayden).
   - User support email: your address.
   - Audience: **External**.
   - Contact information: your address. Agree to the policy, **Create**.
   - Under **Branding**, leave the logo, home page, privacy policy and
     terms links empty. Any of them makes Google want to verify the brand,
     which needs a public home page; this site has none (spec AUTH-3).
2. **Scopes.** Google Auth Platform → **Data access**: only `openid` and
   `.../auth/userinfo.email` (both non-sensitive). Don't add the calendar
   scope here. The site asks for it when you connect Google on the
   Accounts page, and an unverified app may do that (spec F-6).
3. **Publish.** Google Auth Platform → **Audience** → **Publish app** →
   **Confirm**. The status becomes "In production". Don't submit for
   verification. The first time you connect the calendar, Google shows
   "Google hasn't verified this app"; click **Advanced** → **Go to Family
   hub (unsafe)**. It's your own app, limited to 100 users.
4. **Production client.** Google Auth Platform → **Clients** → **Create
   client**.
   - Application type: **Web application**. Name: `hub-prod`.
   - Authorised JavaScript origins: `https://jaydenguo.com`
   - Authorised redirect URIs, one per line:
     `https://jaydenguo.com/auth/google/callback` (sign-in) and
     `https://jaydenguo.com/accounts/google/callback` (connecting Google
     sources).
   - **Create**. Keep the dialog open for the next step.
5. **Store the production values** in Secret Manager. Run each command,
   paste the value (it isn't shown), press Enter, and wait for
   `Created version [1] of the secret …`. This keeps the value out of shell
   history and adds no trailing newline:

   ```bash
   read -rs V && printf '%s' "$V" | gcloud secrets versions add google-oauth-client-id --data-file=-; unset V
   read -rs V && printf '%s' "$V" | gcloud secrets versions add google-oauth-client-secret --data-file=-; unset V
   ```

   Then close the dialog. (The secret can be shown again from the client's
   page if needed.)

6. **Local client.** Create a second client the same way: name `hub-local`,
   origin `http://localhost:3000`, redirect URIs
   `http://localhost:3000/auth/google/callback` and
   `http://localhost:3000/accounts/google/callback`. Put its ID and secret
   in your git-ignored `.env.local` as `GOOGLE_CLIENT_ID` and
   `GOOGLE_CLIENT_SECRET`. Optional: without them, local runs sign in with
   the dev shortcut at `/auth/dev`.
7. **Apply** so Cloud Run gets the new settings. First add your home time
   zone to `prod.tfvars`, e.g. `home_time_zone = "America/Toronto"` (it
   stays out of the public repo). The first apply also creates the daily
   sync trigger and the sync-failure email alert.
   `cd infra && terraform apply -var-file=prod.tfvars`.
8. Check your Google account has 2-step verification on (spec NFR-2):
   <https://myaccount.google.com/signinoptions/twosv>.

## iPhone push notifications (intent 0004, plan O-3, PUSH-6)

Needs the paid Apple Developer account. Until these steps are done the
worker only logs what it would have sent.

1. developer.apple.com → **Certificates, Identifiers & Profiles** → **Keys**
   → **+**: name `hub-apns`, tick **Apple Push Notifications service
   (APNs)**, **Continue**, **Register**, then **Download** the `.p8` file
   (Apple lets you download it once). Note the **Key ID**, and your **Team
   ID** (top right of the page).
2. Store the key, then delete the download:
   ```bash
   gcloud secrets versions add apns-key --data-file="$HOME/Downloads/AuthKey_<KEY_ID>.p8"
   rm "$HOME/Downloads/AuthKey_<KEY_ID>.p8"
   ```
3. In `infra/prod.tfvars` set `apns_key_id` and `apns_team_id`, then apply.
   The worker gets the key only after this, so the order matters: a secret
   without a version would stop the job from starting.
4. Rotating: make a new key, add it as a new version of `apns-key`, change
   `apns_key_id`, apply, then revoke the old key on the Keys page.

## Backups and restore (M1.13, spec NFR-3)

Two layers keep the data safe:

- Cloud SQL's own daily backups (14 kept) and point-in-time restore
  (7 days), both in Toronto.
- A nightly export (`backup` worker job, 03:30 home time) to
  `gs://<project-id>-backups/sql/`, which can't be deleted for a year.
  A failed export emails you.

**Test a restore once before go-live** (and after big schema changes):

1. `infra/bootstrap/restore-test.sh <project-id>` creates a throwaway
   instance `hub-restore-test`, and imports the newest export into it.
   (Run the `backup` job first if there's no export yet:
   `gcloud run jobs execute worker --region northamerica-northeast2 --args=backup --wait`.)
2. In the Console, open **SQL** → `hub` → **Cloud SQL Studio** (database
   `hub`, user `postgres`), and run:

   ```sql
   select 'events' t, count(*) from events union all
   select 'event_revisions', count(*) from event_revisions union all
   select 'sources', count(*) from sources union all
   select 'credentials', count(*) from credentials union all
   select 'sync_runs', count(*) from sync_runs;
   ```

   Do the same on `hub-restore-test` (set its `postgres` password first:
   `gcloud sql users set-password postgres --instance hub-restore-test --prompt-for-password`).
   The counts should match, allowing for anything synced since the export.

3. Delete the scratch instance:
   `infra/bootstrap/restore-test.sh <project-id> northamerica-northeast2 --delete`.

**Restoring for real:** to undo a recent mistake, use point-in-time restore
to a new instance (Console → SQL → `hub` → Backups → Point-in-time recovery),
check it, then point Cloud Run at it (`INSTANCE_CONNECTION_NAME` in
`cloud_run.tf`). For anything older than 7 days, import a nightly export into
a new instance as in the test above.

## Day to day

- Code deploys go through GitHub Actions only. Terraform ignores image changes.
- Infrastructure changes: edit here, `terraform plan`, review, `terraform apply`.
- Run a worker job by hand: `gcloud run jobs execute worker --region northamerica-northeast2 --args=<job>`.
