# Spike notes: 0001 Jayden hub

Findings from the time-boxed spikes in [plan.md §4](plan.md). Each note
says what was checked, what was found, and what changed as a result.

## SP-1: Google Cloud services in Toronto (2026-09-26, partial)

**Checked from the build environment:** nothing directly. Google's
documentation sites (`docs.cloud.google.com`, `firebase.google.com`) are
blocked by the build environment's network policy, and there is no GCP
project yet.

**Expected (from prior knowledge, to be confirmed):**
| Service | Toronto (`northamerica-northeast2`) |
|---|---|
| Cloud Run services and jobs | Expected yes |
| Cloud SQL for PostgreSQL | Expected yes |
| Cloud KMS, Secret Manager (user-managed replica), Artifact Registry, Cloud Storage | Expected yes |
| Cloud Scheduler | Unsure; it only schedules, holds no personal data |
| Regional Cloud Logging buckets | Expected yes |
| Firebase Hosting rewrites to Cloud Run in this region | **Unsure**, see F-14 |

**How it gets confirmed:** the owner runs `infra/bootstrap/check-regions.sh`
in step 4 of `infra/README.md`. The first `terraform apply` is the final
check: it fails on any resource the region doesn't offer.

**Result (2026-09-26):** the owner's first `terraform apply` in
`northamerica-northeast2` succeeded. So Toronto offers every resource in
`infra/`: Cloud Run service and job, Cloud SQL PG16 with in-region backups,
KMS, Secret Manager replica, Artifact Registry, Storage, regional log bucket,
and Firebase Hosting rewrites to Cloud Run (the F-14 region question). The
region script failed on macOS for an unrelated reason (no `timeout`
command) and has been fixed; its output only adds Cloud Scheduler, which
is created in M1.5.

## SP-4: calendar feeds for TeamSnap, Spordle and Veracross (M1.7, 2026-09-27, provisional)

**Owner mapping (O-6):** soccer uses TeamSnap, hockey uses Spordle. The
owner hasn't looked for the subscription links yet.

**Found so far:**
| Source | Feed? | Decision |
|---|---|---|
| TeamSnap | Yes: every team schedule has a calendar subscription (iCal) link. | ICS, generic `ical` adapter. |
| Spordle | Likely: the Spordle app has calendar synchronisation on teams with a Premium subscription (app 1.5.1+), and the Spordle account site has a calendar. Whether a plain iCal link is exposed isn't confirmed. | ICS if a link exists; otherwise a `spordle` login adapter (Playwright), decided when the owner checks. |
| Veracross | Parent portals usually offer a calendar subscription link for the school calendar. The daily timetable needs scraping either way. | Checked in M4 (SP-5/M4.2); the `ical` adapter already handles the calendar feed. |

**How the owner checks:** TeamSnap → the team → Schedule → Sync/Export
calendar → copy the link. Spordle → the team → Schedule → the calendar sync
icon (or My Account → Calendar) → copy the subscription link. Paste each
link only into the site's Accounts page (TeamSnap/Spordle → "Add private
calendar link"), never into chat or the repo.

**Adapter:** `src/adapters/ical/` expands recurring events (RRULE, EXDATE,
moved occurrences) in the feed's own time zone, drops `STATUS:CANCELLED`
events so sync marks them cancelled, and keeps all-day events as dates.
Fixture tests in `tests/unit/adapter-ical.test.ts`.

## Other findings during M0

- **Firebase Hosting only forwards one cookie.** When Firebase Hosting
  rewrites to Cloud Run, it strips every cookie except one named
  `__session`. The spec's sign-in choice (Auth.js) uses several cookies
  (session, CSRF, OAuth state, PKCE), so sign-in would break behind Firebase
  Hosting. Recorded as spec concern F-14, with options.
- **Firebase Hosting is a CDN.** Responses with public cache headers can be
  cached at Google's edge. All pages and API responses must send
  `Cache-Control: private, no-store` (added to M1.1).
- **Docker Hub rate limits.** Base images come from `mirror.gcr.io` (Google's
  Docker Hub mirror) instead of Docker Hub.
- **Budget filtering by service** needs Google's billing service IDs, which
  couldn't be looked up. M0 has one project budget; the separate AI budget
  moves to M5 (after SP-6).
