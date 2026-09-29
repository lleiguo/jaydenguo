# jaydenguo.com

A private hub for Jayden's schedule, sports results and school work. See
[`intent/`](intent/) for the intent, spec and build plan.

## Run it locally

Requirements: Node.js 22+, pnpm (`corepack enable`), Docker. (No Docker?
Any local PostgreSQL 16 works: point `DATABASE_URL` at it instead of running
`pnpm db:up`.) A fresh clone reaches a running app with sample data in a
few minutes, most of it `pnpm install`.

```bash
pnpm install
pnpm db:up                                  # Postgres 16 in Docker
cp .env.example .env.local
export DATABASE_URL=postgres://hub:hub@localhost:5432/hub
pnpm db:migrate
pnpm seed                                   # a made-up season: clashes, swim meets and results
pnpm dev                                    # http://localhost:3000
```

Sign in at <http://localhost:3000/auth/dev> (a shortcut that exists only in
`pnpm dev`), or with Google after adding the local OAuth client to
`.env.local` (see `infra/README.md`, "Google sign-in").

## Checks

| Command                                              | What it runs                                                          |
| ---------------------------------------------------- | --------------------------------------------------------------------- |
| `pnpm lint` / `pnpm typecheck` / `pnpm format:check` | Static checks                                                         |
| `pnpm test`                                          | Unit tests                                                            |
| `pnpm test:int`                                      | Integration tests against `DATABASE_URL`                              |
| `pnpm build`                                         | Next.js standalone build and the worker bundle (`dist/worker.mjs`)    |
| `pnpm test:e2e`                                      | Browser tests against the production build (run `pnpm build` first)   |
| `pnpm check:build`                                   | Confirms the dev sign-in shortcut is absent from the production build |

## Worker jobs

Background work runs as jobs of one worker program, locally and on Cloud Run:

```bash
pnpm job help        # list jobs
pnpm job migrate     # apply database migrations
pnpm job sync all    # sync every enabled source now
pnpm smoke <id>      # live check of one source, saves nothing
pnpm seed            # sample data for local development
```

## Runbook (production)

Everything runs in project `jaydenguo`, region `northamerica-northeast2`
(Toronto). Worker jobs run as the Cloud Run job `worker`:

```bash
gcloud run jobs execute worker --region northamerica-northeast2 --args=<job>[,<arg>…] --wait
```

Logs: Console → Logging → Logs Explorer, bucket `hub-logs` (Toronto,
30 days). Useful filters: `jsonPayload.message="sync failed"`,
`jsonPayload.message="video review failed"`, `severity>=WARNING`.

### Redeploy

- **Normal:** merge to `main`. CI runs, then the Deploy workflow builds
  both images, updates the worker, runs `migrate`, deploys `web` and calls
  `/api/healthz`.
- **Deploy again without a change** (e.g. a failed deploy step): GitHub →
  Actions → Deploy → Run workflow.
- **Roll back the site:** Console → Cloud Run → `web` → Revisions → send
  100% of traffic to the previous revision (or
  `gcloud run services update-traffic web --region northamerica-northeast2 --to-revisions=<rev>=100`).
  Roll the worker back with
  `gcloud run jobs update worker --region northamerica-northeast2 --image <previous worker image>`.
  Migrations only add; an older version runs on a newer schema. Then fix
  forward on `main`.
- **Stale page after a deploy:** every response is `private, no-store`,
  so Firebase Hosting shouldn't cache pages. If a stale page ever appears,
  a new Hosting release clears its cache:
  `cd infra && terraform apply -replace=google_firebase_hosting_release.hub`.

### Rotate keys and secrets

- **Credential key (Cloud KMS `hub/credentials`):** rotates itself every
  90 days; old versions stay enabled so stored credentials still open.
  After a rotation (or a manual one: Console → Key Management → `hub` →
  `credentials` → Rotate), re-wrap every stored data key with the new
  version, then old versions can be disabled after a week:
  `gcloud run jobs execute worker --region northamerica-northeast2 --args=rotate-keys --wait`.
- **Session secret (`auth-secret`):** add a new version
  (`read -rs V && printf '%s' "$V" | gcloud secrets versions add auth-secret --data-file=-`)
  and redeploy `web`. Every device is signed out.
- **Google OAuth client secret:** create a new secret on the OAuth client
  (Console → APIs & Services → Credentials), add it as a new version of
  `google-oauth-client-secret` the same way, redeploy `web` and update the
  worker (`gcloud run jobs update worker --region northamerica-northeast2`),
  then delete the old client secret. Connected Google accounts keep working.
- **A site password** (Commit Swimming, Veracross, Tennis Canada): change
  it on the site, then Settings → Accounts → the login → update the
  password → Test connection.
- **A feed link** (TeamSnap, Spordle): get a fresh link on the site, update
  it on Settings → Accounts. The old link keeps working until the site
  revokes it.

### Reconnect a source

- **Red source on Settings → Sources:** the card says why in plain words.
  "Login failed" or "Google access was revoked": fix the account on
  Settings → Accounts (update the password, or Reconnect Google), press
  Test connection, then Refresh on the source.
- **Veracross asks for a sign-in code:** Settings → Accounts → the
  Veracross login → Test connection, then type the emailed code in the box
  that appears. The browser is remembered, so syncs carry on without it.
- **Google features:** each one is its own grant on Settings → Accounts
  (calendar; Classroom; Gmail; Drive and Photos for videos; the calendar
  copy). Connecting again replaces the token and keeps the sources.
- **Three failures in a row** send an email (SYNC-4). A successful run
  resets the count.

### Restore a backup

See [`infra/README.md`](infra/README.md), "Backups and restore": point-in-time
restore for the last 7 days, a nightly export for anything older, and the
restore test.

### When an adapter breaks (a site changed its pages)

1. The source goes red with a plain-language reason; the other sources
   carry on (one job per source, NFR-8). Nothing already synced is changed
   or deleted by a failed run (NFR-6).
2. Look at the run in Logs (`jsonPayload.message="sync failed"` with the
   source ID) and run a live check that saves nothing:
   `gcloud run jobs execute worker --region northamerica-northeast2 --args=smoke,<source-id> --wait`.
3. Until it's fixed, switch the source off on Settings → Sources if it
   keeps failing, and add anything urgent by hand (the calendar's
   "+ Add event", Tennis → Results → add a match, Swimming → add a result;
   SYNC-6).
4. Fix it in the adapter under `src/adapters/<kind>/`: save the new page as
   a fixture (scrub names; no real data about Jayden or other players),
   make the adapter test pass, then merge. The next sync picks it up.

### AI features (Vertex AI)

- **Video reviews fail with "Claude is over its quota":** Claude's Vertex
  quota is 0 until raised (IAM & Admin → Quotas →
  `global_online_prediction_requests_per_base_model`,
  `anthropic-claude-opus`). Meanwhile set Videos → Review settings to
  "Gemini only". Email suggestions and match explanations need Claude too.
- **"Google Photos refused" / "Can't open this link":** the Drive or Photos
  Picker API is off in the project, or the Google account lost that
  access. Check `terraform apply` is clean, then reconnect "Drive and
  Photos" on Settings → Accounts.
- **Video playback (intent 0003):** a finished review keeps a copy of the
  reviewed clip in the `<project>-media` bucket (`reviews/<id>.mp4`), shown
  on the review page. "Delete video" there removes it for good. No player
  on a new review means the copy wasn't saved: look for
  `jsonPayload.message="playback copy not saved"` in the worker's logs.
  Locally, set `MEDIA_DIR` to a folder for both `pnpm dev` and the worker;
  without it no copy is kept.
- **Cost:** each review shows its cost; the "hub AI monthly" budget emails
  at 50/90/100%. Prices used for the estimates are in
  `src/server/llm/pricing.ts`.
- **Calendar copy errors** show under Settings → General → Copy to Google
  Calendar; "Copy now" retries. Deleting the "Jayden (hub)" calendar in
  Google Calendar is fine: the next run makes a new one.

### Costs page

Settings → Costs shows the bill from the Cloud Billing export to BigQuery,
read daily by `costs:sync`. If it's empty: turn the export on once (the
page lists the steps), set `billing_export_dataset` and then
`billing_export_table` in the Terraform variables and apply. Refresh on
the page reads it again; an error shows there in words. The AI-by-feature
table works without the export.
