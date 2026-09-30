# Plan: Jayden's schedule and progress hub (jaydenguo.com)
Source: [spec.md](spec.md) (approved 2026-09-26). Status: approved (2026-09-26).
Owner: Jayden's parent (lleiguo). Written by Claude, reviewed by the owner.

This plan says how the approved spec will be built: in what order, in which
files, and how each step is proven done. Every task names the spec IDs it
delivers. When the build departs from this plan, this file is updated in the
same commit as the code (see [../README.md](../README.md)).

---

## 1. Working agreement

- **Branches and PRs:** one PR per milestone (or smaller). Each PR description
  lists the task IDs it closes. Nothing merges to `main` with red CI.
- **Definition of done for every task:**
  - the code and its tests are merged;
  - the spec IDs it names meet their acceptance criteria;
  - the README is updated if setup changed;
  - this plan's status table (§9) is updated.
- **Checks before every push:** typecheck, lint, unit tests, and the
  end-to-end tests that touch the changed area.
- **Owner reviews:** at the end of each slice (S1–S5), the owner uses the
  deployed site for a few days before the next slice starts.
- **Secrets:** never in the repo, chat, logs or CI output. They go into
  Secret Manager or the site's Connected accounts page (CRED).

---

## 2. Tech stack and repository layout

| Area | Choice |
|---|---|
| Runtime | Node.js 22 LTS, TypeScript (strict), pnpm |
| Web | Next.js (App Router) in `output: standalone` mode. Own Google OpenID Connect sign-in (`openid-client`), `__session` cookie, Postgres sessions (F-14 option A) |
| API | Route handlers under `/api/v1/*`. zod schemas generate the OpenAPI document (`/api/v1/openapi.json`). |
| Database | PostgreSQL 16. Drizzle ORM with versioned SQL migrations (drizzle-kit). |
| UI | FullCalendar (standard), Recharts, Tailwind CSS, PWA manifest and service worker |
| Worker | Same codebase with a CLI entry (`src/worker/main.ts`), Playwright (Chromium), ffmpeg |
| LLM | Vertex AI: `@google/genai` (Gemini) and `@anthropic-ai/vertex-sdk` (Claude) |
| Tests | Vitest (unit and integration against a real Postgres), Playwright Test (end-to-end) |
| Infrastructure | Terraform (Google provider), GitHub Actions, Workload Identity Federation |

```
/
├── README.md                    # run locally in 5 minutes; deploy; runbook
├── intent/                      # intent, spec, plan (this folder)
├── infra/                       # Terraform: project services, Cloud Run, SQL, KMS, IAM, buckets, scheduler, budgets, logs
├── docker/
│   ├── web.Dockerfile           # Next.js standalone
│   └── worker.Dockerfile        # Playwright base image + ffmpeg
├── docker-compose.yml           # local Postgres 16
├── db/
│   ├── schema/                  # Drizzle table definitions (spec §7.1)
│   └── migrations/              # generated SQL, reviewed in PRs
├── src/
│   ├── app/                     # Next.js pages and /api/v1 route handlers
│   ├── components/              # calendar, toggles, charts, forms
│   ├── domain/                  # pure logic: clashes, overrides, upsert rules, ratings, forecasts
│   ├── server/                  # auth, db client, repositories, crypto (KMS/local), job launcher
│   ├── adapters/                # one folder per source (spec §3.4), same interface
│   │   ├── google-calendar/  ical/  teamsnap/  spordle/  gmail/
│   │   ├── tennis-tc/  commit-swim/  veracross/  classroom/
│   │   └── video/  (drive, photos-picker)
│   ├── llm/                     # Vertex clients, prompts (versioned), JSON schemas, debate orchestrator
│   └── worker/                  # CLI entry: sync:<source>, review:<id>, backup, rotate-keys
├── tests/
│   ├── fixtures/<source>/       # recorded HTML/JSON/ICS pages and LLM responses
│   ├── unit/  integration/  e2e/
└── .github/workflows/           # ci.yml, deploy.yml
```

**Adapter interface** (all sources): `test(credentials)`,
`fetch(credentials, since)` returns raw data, then `normalise(raw)` returns
records with a stable `external_id`. The shared upsert engine
(`src/domain/upsert.ts`) writes records, revisions and cancellations. An
adapter never writes to the database directly. This lets each adapter be
tested from fixtures alone (NFR-8).

---

## 3. Owner prerequisites

Only you can do these. Each is needed by the milestone shown, and I'll give
step-by-step instructions when we get there.

| # | What | Needed by |
|---|---|---|
| O-1 | Create a GCP project with billing enabled. Grant the deploy identity access (a one-time Terraform bootstrap). | M0 |
| O-2 | Access to the DNS settings for `jaydenguo.com` at the registrar (for Firebase Hosting A/TXT records). | M0 |
| O-3 | Google OAuth consent screen and clients (prod plus a local-dev client), published as an unverified personal app (F-6). | M1 |
| O-4 | Confirm the home time zone, the household calendar, and the Gmail labels or senders to watch. | M1, M5 |
| O-5 | Tennis Canada tournament site and Commit Swimming logins, entered on the Connected accounts page. Review each site's terms (F-1). | M2, M3 |
| O-6 | TeamSnap and Spordle calendar subscription links, or logins. Which team is soccer and which is hockey. | M1 |
| O-7 | Veracross parent login. Consent to connect Jayden's Classroom account (the school may block it: F-5). | M4 |
| O-8 | Enable Gemini and Claude on Vertex AI (Model Garden) in the project. | M5 |
| O-9 | A few videos of Jayden in Photos or Drive (serve, forehand, freestyle, IM turn) to evaluate the debate. | M5 |

---

## 4. Spikes (do first; each is 0.5–1 day, time-boxed)

Spikes answer the open risks before the code depends on them. Each ends with
a short note in `intent/0001-jayden-hub/spikes.md`, and this plan is updated
if the answer changes a task.

| ID | Question | Spec ref | Done when |
|---|---|---|---|
| SP-1 | Are Cloud Run (service and jobs), Cloud SQL, KMS, Scheduler, Artifact Registry and Firebase Hosting rewrites all available in `northamerica-northeast2`? Can log buckets be regional? | F-11, NFR-1a | A list per service: Toronto, or Montréal as fallback. |
| SP-2 | Can the tournament site be logged into and read with Playwright? Find the page structure for the player profile, tournaments, draws, matches and opponent profiles. | TEN, F-1 | A script prints Jayden's last 10 matches and one opponent's last 10. Fixtures saved. |
| SP-3 | Same for Commit Swimming: meets, entries, results, practices. | SWM, F-1 | A script prints his results for one meet and all 200 IM swims. Fixtures saved. |
| SP-4 | Do TeamSnap, Spordle and Veracross provide iCal subscription URLs? | SRC-2/3/7, F-7 | Each has "ICS" or "scrape" decided. |
| SP-5 | Does the Classroom API work with Jayden's school account (OAuth consent and read of courses and coursework)? | SCH-3/4, F-5 | Works, or blocked with the error message recorded and a fallback chosen with the owner. |
| SP-6 | Vertex AI: which Gemini and Claude model IDs and locations are available? Test Gemini video input with a custom frame rate, and Claude with about 60 frames. Measure cost per call. | VID, NFR-1a | One real clip reviewed by both. Cost per debate measured, and the §8 estimate updated. |

SP-1 runs in M0. SP-4 runs in M1. SP-2, SP-3 and SP-5 run at the start of
M2, M3 and M4. SP-6 runs at the start of M5 (it can be pulled earlier if
useful).

---

## 5. Milestones and tasks

Estimates are in focused engineering days for one developer working with
Claude Code. They are rough and will be revised after each milestone.

### M0: Skeleton, local dev and infrastructure (≈ 4 days)
| Task | Description | Spec | Done when |
|---|---|---|---|
| M0.1 | Scaffold the repo: Next.js + TS strict, pnpm, ESLint/Prettier, Vitest, Playwright Test, layout as in §2. | NFR-8 | `pnpm test` and `pnpm lint` pass on an empty app. |
| M0.2 | `docker-compose.yml` for Postgres 16. Drizzle setup. First migration (users, sources, sync_run, audit_log). | §5.2 | `pnpm db:migrate` works locally and in CI. |
| M0.3 | CI workflow: install, typecheck, lint, unit tests, integration tests (Postgres service), e2e (Chromium), dependency audit. | NFR-2, §9 | Green on a PR. |
| M0.4 | A SessionStart hook for Claude Code on the web: installs dependencies and starts Postgres, so tests run in cloud sessions. | §5.2 | A fresh cloud session can run `pnpm test`. |
| M0.5 | SP-1 region check. | F-11 | Note in spikes.md. |
| M0.6 | Terraform: enable APIs; Artifact Registry; Cloud SQL (PG16, smallest shared-core, backups + PITR 7 d, IAM auth, no authorised networks); KMS key ring and key; Secret Manager; service accounts `web` (KMS encrypt only) and `worker` (KMS decrypt only); regional log bucket with the `_Default` sink routed to it; backup bucket with a 1-year retention policy; a project budget alert (the separate AI budget moves to M5.1, see spikes.md). All in Canada. | NFR-1a, NFR-3, NFR-7, CRED-3 | `terraform plan` is clean. Applied to the owner's project. |
| M0.7 | Dockerfiles for web and worker. Deploy workflow: build, push to Artifact Registry, deploy to Cloud Run (web service, worker job) via Workload Identity Federation. | §5 | Merging to `main` deploys a "hello" page. |
| M0.8 | Firebase Hosting with a rewrite to Cloud Run. Connect `jaydenguo.com` (O-2). HSTS and security headers. `robots.txt` disallow-all. `noindex`. | AUTH-3, NFR-2 | `https://jaydenguo.com` serves over TLS, and the headers pass a check. |

### M1 (slice S1): Foundation (≈ 12 days)
| Task | Description | Spec | Done when |
|---|---|---|---|
| M1.1 | Google sign-in with an allow-list (owner only): own OpenID Connect flow (authorization code + PKCE; state and verifier kept server-side against a pre-login session), a single `__session` cookie (HttpOnly, Secure, SameSite=Lax) holding a random session ID, sessions table in Postgres with expiry and revocation (F-14 option A). All responses send `Cache-Control: private, no-store` (Firebase Hosting is a CDN). Middleware guards every page and `/api/v1/*`. "Sign out everywhere". Login rate limit. Dev-only login shortcut, with a CI check that it's absent from the production build. | AUTH-1..4, NFR-2 | An e2e test proves that a non-allow-listed account and an anonymous request are refused on every route (route list generated, not hand-written). |
| M1.2 | Crypto module: envelope encryption (AES-256-GCM data keys wrapped by KMS; a local key in dev). `key_version`. Rotation command. Log redaction helper. | CRED-3, CRED-5, §7.3 | Unit tests. An integration test proves a sync log contains no secret. The rotation test re-wraps all keys. |
| M1.3 | Connected accounts page and API. Write-only secret fields, "Test connection", remove (deletes ciphertext and revokes OAuth), audit log entries. Google OAuth connect flow with scopes requested only when needed. | CRED-1,2,4,6,7 | e2e test: add, test, update and remove a credential. The API has no route that returns a secret. |
| M1.4 | Schema for events, overrides, revisions, locations and conflicts. Upsert engine (insert, update with revision, mark cancelled, respect overrides and manual corrections, "source changed" flag). | CAL-6, CON-5, SYNC-3 | Property tests: running twice gives no changes; overrides are never lost; nothing is hard-deleted. |
| M1.5 | Worker CLI and job launcher. The web app starts a Cloud Run job execution; Scheduler starts the daily run. Advisory lock per source. Minimum 1-hour gap per source. Run history UI. Readable errors. Email alert after 3 failures in a row. | SYNC-1,2,4,5 | Two on-demand refreshes of one source give one run. The run history shows counts. |
| M1.6 | Adapters: household Google Calendar (SRC-1) and a generic iCal adapter used for TeamSnap, Spordle and Veracross when SP-4 says ICS. Category mapping per source (O-6). | SRC-1/2/3/9, ACT-1 | Fixture tests. A live smoke test against the owner's calendar. |
| M1.7 | SP-4 feed check. If Spordle needs scraping, add a `spordle` Playwright adapter. | F-7 | Decision recorded. The adapter passes its fixture tests. |
| M1.8 | Calendar UI with FullCalendar: day, week, month and agenda (default on phones); category colours and icons; filters per device; School/Activities toggle chips; closure banners; event detail with source and last sync; manual events with repeat rules; soft delete with a "Deleted" view. | CAL-1..5, CAL-3a, CAL-7, CAL-9, NFR-9 | e2e tests at 375 px and desktop. Toggles hide and show layers. A daylight-saving test passes. |
| M1.9 | Clash engine: overlap plus location travel buffers, attendance flags, school periods only on school days, "clash with a hidden event" marker, badge and clash list. | CON-1, CON-2, CAL-3a | Unit tests cover every rule in CON-1. Detection over 2 years of events runs in under 200 ms (benchmark in CI). |
| M1.10 | Drag and drop with touch long-press; "Move to…" menu; skip; accept clash; 10 s undo; recompute clashes on change. | CON-3, CON-4, CON-6, NFR-9 | An e2e test drags one event of a clash (mouse and touch emulation) and the highlight clears. Undo restores it. |
| M1.11 | Live updates: a `/api/v1/changes?since=` endpoint and 10 s polling while the page is visible. | CAL-8 | e2e with two browser contexts: a change appears in under 10 s. |
| M1.12 | PWA manifest, icons, service worker (app shell only; no caching of API data). | NFR-5 | Installable on iOS and Android. Lighthouse PWA check passes. |
| M1.13 | Backups: a nightly worker job exports Cloud SQL to the retention bucket. Restore runbook in the README. Test restore once. | NFR-3 | The restore is done into a scratch instance and its row counts match. |
| M1.14 | Seed script with a realistic fake season. README "run it locally in 5 minutes". | §5.2 | A fresh clone reaches a running app with seed data in under 10 minutes (timed). |

**Build notes (M1):**
- M1.1: Next.js always serves hashed `/_next/static/*` files with
  `public, max-age=31536000, immutable` and doesn't allow overriding it.
  Those files are build output with no personal data, so they are the one
  exception to `Cache-Control: private, no-store`; the proxy skips them.
- M1.1: end-to-end tests sign in through a fake OpenID Connect provider on
  localhost (`tests/e2e/support/fake-oidc.ts`, allowed only on the loopback
  address), or by writing a session row directly. The production build has
  no sign-in shortcut; `pnpm check:build` checks it in CI.
- M1.1: session rows are keyed by an HMAC of the cookie value (key:
  `auth-secret`), so a database copy can't be replayed as a cookie. The
  proxy checks the session in Postgres on every request, so "sign out
  everywhere" takes effect immediately.
- M1.2: the worker service account can also *encrypt* (not only decrypt),
  because the `rotate-keys` job re-wraps data keys with the current KMS key
  version. The web service still can't decrypt. ESLint blocks web code from
  importing the decrypt function or worker modules.
- M1.2: CRED-5 is enforced twice: fields with secret-looking names are
  redacted, and every decrypted value is registered with the logger and
  scrubbed from any log line. The "sync log contains no secret" test runs a
  real worker job; it is extended to sync runs in M1.5.
- M1.3: a credential isn't tied to one source (spec §7.1 has
  `credential.source_id`); instead `sources.credential_id` points at it,
  because one Google grant serves several sources (Calendar now; Gmail,
  Classroom, Drive later). One credential per Google account; reconnecting
  replaces the token.
- M1.3: "Test connection" and removing a Google grant need the plaintext,
  so the web app starts them as worker jobs (`credential:test`,
  `credential:remove`). The job launcher from M1.5 was built here for that.
- M1.4: accepted clashes are stored per pair of events in `conflicts`
  (spec §7.1 puts `accept_clash` on the override), because accepting one
  clash shouldn't hide a new clash with a third event. Detected clashes are
  computed, not stored. Manual repeating events are stored as a series and
  written out as ordinary event rows through the same upsert engine.
- M1.4: a sync only cancels missing events that start inside the window
  the adapter fetched (e.g. from 30 days ago), so past events a feed stops
  listing stay as history instead of turning "cancelled".
- M1.5: "sync all" runs sources one after another in one job execution,
  each with its own lock, 10-minute budget and error handling, rather than
  one execution per source. One broken site still can't block the others.
- M1.5: the SYNC-4 email is a Cloud Monitoring log-match alert on the
  worker's `sync_failed_repeatedly` log line (`infra/alerts.tf`), so no
  mail service or Gmail scope is needed.
- M1.6: the Google account's calendar list is saved (names and IDs only)
  when Google is connected, so the Sources page can offer it without the
  web app ever using the refresh token.
- M1.7: SP-4 is provisional (see spikes.md): TeamSnap is ICS; Spordle is
  ICS if the owner finds a link, else a login adapter is added then.
- M1.8: FullCalendar is v7 (current at build time). It ships plain CSS files
  instead of injecting styles, so it runs under the nonce-only CSP with no
  exceptions (an e2e test checks for violations). The calendar area keeps
  FullCalendar's light theme in dark mode.
- M1.8: all-day events never clash (tournaments, closures, reminders), and
  school classes don't clash with each other.
- M1.10: undo works for 10 s through an "undo" instruction returned by each
  action; overrides remember the override they replaced, so undoing a second
  move restores the first. The touch drag test sends real touch events
  (long-press, then drag) through the Chrome DevTools Protocol.
- M1.11: browsers poll every 8 s rather than 10 s, so the worst case,
  including reloading the data, stays under CAL-8's 10 seconds.
- M1.12: Lighthouse no longer has a PWA category, so the e2e suite checks
  the install criteria directly (manifest fields, 192/512 and maskable
  icons, Apple touch icon, a service worker that controls the page, an
  offline page) and that no page or API response is cached.
- M1.13: the export is started by the `backup` worker job through the Cloud
  SQL Admin API with a custom role (`cloudsql.instances.export`, `.get`),
  and a failed export emails the owner. The restore test needs the owner's
  project: `infra/bootstrap/restore-test.sh` and the runbook in
  `infra/README.md`.
- M1.14: a fresh clone reached a running app with seed data in 14 s on a
  machine with a warm pnpm store (2026-09-27); a cold install adds the
  download time of `pnpm install`.

**S1 exit:** the owner uses the calendar for about a week. Fix list triaged
before M2.

### M2 (slice S2): Swimming (≈ 6 days)
| Task | Description | Spec | Done when |
|---|---|---|---|
| M2.1 | SP-3 Commit Swimming spike. | F-1 | Fixtures saved. Page map in spikes.md. |
| M2.2 | Schema: swim meet, entry, result (course-aware; time in ms; splits; `manual_correction`). | §7.1 | Migration merged. |
| M2.3 | `commit-swim` adapter: login, meets, entries, results, practices if present. Polite rate limit. | SRC-6, SWM-1..3, SYNC-5 | Fixture tests. Live smoke test. Meets appear on the calendar. |
| M2.4 | Swimming pages: meet list and detail, results with PB flag and change from previous best, PB table. | SWM-2, SWM-3, SWM-6 | e2e tests on seed and fixture data. |
| M2.5 | Progression charts per event and course (never mixing SCM and LCM). | SWM-4 | Visual check. A unit test proves courses are separated. |
| M2.6 | Forecast: robust fit (exponential decay to an asymptote), 6/12-month projection with a range, guardrails (≥ 4 results over ≥ 6 months, never faster than the asymptote), "Estimate" label. | SWM-5, §6.2 | Unit tests on synthetic series. A backtest on his history is reported in the PR. |
| M2.7 | Manual add or correct of results, with the "source disagrees" flag. | SWM-7, SYNC-6 | e2e test: a correction survives the next sync. |

**Build notes (M2):**
- M2.2: PBs aren't stored (spec §7.1 lists `is_pb`); they're computed from
  the results (`src/domain/swim.ts`), so a correction can't leave a stale
  PB flag. Each result row holds the values the site shows, the source's
  latest version (`source_values`), and `corrected_at`; every change is
  written to `swim_result_revisions`.
- M2.3: Commit Swimming has no HTML pages to scrape; its data comes over
  Meteor's websocket. The adapter signs in with Playwright
  (`playwright-core`, pinned to the worker image's version) and runs an
  extractor inside the page that calls the site's own read methods and
  returns only whitelisted fields for one swimmer (spikes.md SP-3).
- M2.3: Commit doesn't show practices to parents, so SWM-1 practices come
  from the household calendar or manual repeating events. Meets he
  declined are left out; invitations he hasn't answered appear as
  optional all-day events ("Not signed up yet"). Team events with a
  sign-up (team practices, socials) go on the calendar, not the meet list.
- M2.3: a swim the owner typed in by hand is linked to the source's copy
  when it arrives (same date, distance, stroke and course), instead of
  appearing twice. Blanks the owner left (place, heat, lane, meet) are
  filled; the owner's time stays.
- M2.3: tests run the real adapter (Chromium, sign-in, extractor) against a
  local fake of the site (`tests/e2e/support/fake-commit.ts`), which also
  serves another family's swimmer to prove none of it is kept.
  `COMMIT_SWIM_BASE_URL` points the adapter at it and only accepts loopback
  addresses. "Test connection" signs in to Commit Swimming.
- M2.4: the swimming pages are server-rendered from the same read models
  as `/api/v1/swim/*` (spec §1.1), so a future app gets the same data.
  "Refresh" on the page starts the Commit Swimming sync (SYNC-2).
- M2.5: the progression chart is a small hand-drawn SVG component instead
  of Recharts: it renders on the server, sets no inline styles (the strict
  CSP stays clean without client-only rendering), and adds no dependency.
  Faster times are higher; the PB line steps; every value is also in the
  table under it; keyboard focus shows each swim's details.
- M2.6: the forecast fits against time since his first swim in the event,
  not age: for this curve the two give the same fit, so no birth date is
  stored. It fits every timed swim with a robust (Huber) loss rather than
  only the PB points, so the estimate is of a typical swim, not a best.
  The range is 90% of the residual spread, corrected for small samples and
  widened the further past the data it reaches. `scripts/swim-backtest.ts`
  reports aggregate errors only (the repository is public).
- M2.7: a correction can be undone ("Use Commit's time"), which returns
  the row to the source's values. Results are soft-deleted.

### M3 (slice S3): Tennis (≈ 8 days)
| Task | Description | Spec | Done when |
|---|---|---|---|
| M3.1 | SP-2 tournament site spike. | F-1 | Fixtures saved. Page map in spikes.md. |
| M3.2 | Schema: tennis player, tournament, draw, match (`manual_correction`). | §7.1 | Migration merged. |
| M3.3 | `tennis-tc` adapter: Jayden's tournaments, entries, draws, matches, schedule; opponents' profiles and recent matches (one hop). Rate-limited crawl with a cap per run. | SRC-5, TEN-2..5, TEN-7 | Fixture tests. Live smoke test. Tournaments appear on the calendar. |
| M3.4 | Tennis pages: tournaments; draw with next opponent; head-to-head; opponent form; results history with W–L. | TEN-2..5, TEN-7 | e2e tests on fixture data. |
| M3.5 | Glicko-2 ratings over the crawled match set. Win probability with head-to-head, form and margin adjustments. Confidence levels. Backtest and calibration page. | TEN-6, §6.1, F-2 | Unit tests against published Glicko-2 examples. The calibration table is shown in the PR. |
| M3.6 | Prediction explanation from Claude (Vertex), generated only from the computed numbers. Prompt and version stored. | TEN-6 | A snapshot test with recorded LLM responses. |
| M3.7 | Manual score and time edits, with the "source disagrees" flag. | TEN-8, SYNC-6 | e2e test: an edit survives the next sync. |

**Build notes (M3):**
- M3.1: every page TEN-2..7 needs is public and server-rendered (spikes.md
  SP-2), so the `tennis-tc` adapter reads them over plain HTTP with an HTML
  parser (`node-html-parser`), not Chromium, and without signing in. The
  source is set up with his public profile link (`config.profileUrl`)
  instead of a stored login. O-5 (the Tennis Canada login) is only needed
  if signed-in pages turn out to show entries before draws are published
  (open owner decision). **Decided 2026-09-27:** the owner wants that
  signed-in look done (see handoff.md).
- M3.6: **decided 2026-09-27:** Claude is enabled on Vertex, and the owner
  accepts sending the computed match numbers (no raw pages or profiles) to
  a region outside Canada if Claude isn't served in one. Storage stays in
  Canada.
- M3.2: the schema has `tennis_players`, `tennis_tournaments`,
  `tennis_draws` (his draws only: position, seed, next match),
  `tennis_matches` (generic two-sided matches, so opponents' one-hop
  matches fit; doubles partners optional) and `tennis_match_revisions`.
  Ratings aren't stored (spec §7.1 lists `rating`, `rating_rd`); they'll be
  computed from the matches, like PBs in M2. Players are keyed by the
  Tennis Canada member number. No ranking column: the site shows none for
  his age group (SP-2). Split out onto `m3/2-schema` (with a migrations
  test for the match rules) so it merges ahead of the adapter.
- M3.3: a match's external ID is tournament + draw + the two sides' member
  numbers, so the same match read from both players' profiles is stored
  once. Only his matches can be cancelled by a sync; opponents' matches and
  tournaments never are, because not every opponent is read every run. The
  crawl reads his profile and every year, overviews of tournaments from the
  last 30 days, the draws of tournaments from the last 10 days, then up to
  30 opponents (next opponents first, then the last 12 months), capped at
  150 requests per run.
- M3.3: the calendar gets his tournaments (all-day, multi-day) and his
  matches with a published start time (one hour), including a next match
  whose opponent is still "winner of A vs B".
- M3.3: a match the owner typed in is linked to the site's copy (same
  day, opponent matched by name, ignoring case and accents); the row then
  points at the site's players, with the owner's score flipped if the site
  lists the sides the other way round. The Sources page takes the profile
  link for `tennis_tc` (no account). Tests pin "today" to the fixture's day
  with `TENNIS_TC_NOW`, honoured only with a loopback `TENNIS_TC_BASE_URL`.
- M3.4: pages `/tennis` (next matches with predictions; tournaments in
  progress, upcoming, past), `/tennis/tournaments/[id]`,
  `/tennis/players/[key]` (key = member number), `/tennis/results`
  (`?season=`), `/tennis/accuracy`, all read from
  `src/server/tennis/load.ts` and served under `/api/v1/tennis/*`.
  Head-to-head and form count singles only. Seasons are calendar years,
  as the site groups them. His rows from several sources count as one
  player. No seed data: the pages need a source (or the fake site).
- M3.5: Glicko-2 with monthly rating periods, τ = 0.5, starting at
  1500/350/0.06; walkovers, doubles and unplayed matches aren't rated.
  The probability's log-odds move at most ±0.6 for head-to-head (shrunk:
  0.2 × net wins / (meetings + 3)), last-10 form and share of games won.
  Confidence is low under 5 rated matches or RD over 200, high from 15
  matches with RD at most 110. The score band comes from the probability.
  `scripts/tennis-backtest.ts` prints aggregate calibration only.
- M3.6: `tennis_explanations` (migration 0008) stores each paragraph with
  its inputs, prompt version and model; the sync writes them for his next
  matches after a tennis run (best effort, at most 5 per run) when
  `VERTEX_PROJECT` is set, and the pages show a stored one only when the
  numbers still match. Claude gets rounded numbers and no names. Model
  `claude-opus-5` on the `global` endpoint (Terraform `claude_region`).
  **Open:** the project has no Claude quota on Vertex yet (429 on
  2026-09-27), so the snapshot test replays a hand-written stand-in
  (`tests/fixtures/llm/tennis-explain.json`, `recorded: false`) until it
  can be recorded with `RECORD_LLM=1`.
- M3.7: `src/server/tennis/mutations.ts`: add a match, correct the result,
  score (typed from his side) or start time, use the site's result,
  delete and restore. Corrections keep the owner's values through syncs
  and flag disagreements, as in M2.7.

### M3b: Tournament entries (≈ 3 days; added 2026-09-27)
The owner asked for three scheduled jobs on top of M3 (spec TEN-9..11).
| Task | Description | Spec | Done when |
|---|---|---|---|
| M3b.1 | SP-7: the public tournament search, event lists and entry lists; the signed-in entry form. | TEN-9, TEN-10, F-1 | Page map in spikes.md. **Public part done; signed-in part open** (needs the owner). |
| M3b.2 | Schema: `tennis_entries` (migration 0009). | §7.1 | Migration merged. |
| M3b.3 | `tennis:enter` (Thursday noon): search, pick his event, drive time, one per weekend, enter or list with the link. | TEN-9 | Integration test against the fake site. |
| M3b.4 | `tennis:acceptance` (Friday 10:00): main draw or reserve list and place. | TEN-10 | Integration test. |
| M3b.5 | `tennis:draw-watch` (hourly, Mon–Wed 07:00–21:00): find his draw, then the full sync; the sync reads entered tournaments before his profile lists them. Opponent level on the next-match card; no score band. | TEN-11, TEN-3, TEN-6 | Integration test: draw found → sync → watch stops; nothing to watch → no requests. e2e for the card. |
| M3b.6 | Registrar: enter him on the site with the stored Tennis Canada login (the Accounts page option kept for this), and tell "entered" from "payment needed". | TEN-9, CRED-2 | **Built 2026-09-28** (`m3b/6-auto-entry`): unit tests on the form and outcomes, integration tests against the fake site's signed-in pages. |
| M3b.7 | Terraform: three Cloud Scheduler jobs, the Routes API, `ROUTES_PROJECT` and Service Usage Consumer for the worker. | TEN-9..11 | `terraform validate`; applied before the code merges. |

**Build notes (M3b, 2026-09-27):**
- Everything but entering is read from **public** pages (spikes.md SP-7):
  the search (`/find/tournament/DoSearch`, "Online entry open", Rookie,
  postal code and radius), `/sport/events.aspx` and `/sport/event.aspx`
  (entry list with "Maindraw" / "Reserve list N", draws once out). Same
  politeness as the sync: 2 s apart, a cap per run (150 / 60 / 40).
- The entry form (`/individual-entry/<id>`) needs a sign-in, so it isn't
  mapped yet. `src/server/tennis/entries.ts` takes a `Registrar`; the
  worker passes `manualRegistrar`, which leaves every entry as "found"
  with the site's entry link on the Tennis page.
- Settings live in the Tennis Canada source's config (`config.entry`:
  home postal code, longest drive, event words), edited from its card on
  the Sources page. Config updates now merge instead of replacing.
- Drive time: Google Routes API with the worker's service account
  (`ROUTES_PROJECT`), cached per trip. Without it, the search radius is
  about 1 km per minute of the limit, rounded down to the site's options.
- The sync is given his active entries (`AdapterContext.tennisEntries`):
  it reads their event pages for draws and uses his tournament player
  number from the entry list, so a fresh draw finds him before he's
  played a match there. His entered tournaments reach the calendar.
- The draw watch runs the full sync (not a lighter one) so opponents and
  predictions come with it; SYNC-5's hourly limit still applies, so a
  watch right after another run waits for the next hour.
- Fixed on the way: a typed-in match linked to another source's players
  made that other source's sync fail (`src/server/tennis/apply.ts`).
- Entry fixtures (`tests/fixtures/tennis-tc/entries/`) are hand-built
  from the real markup with invented names, not recorded pages.
- M3b.6 (2026-09-28, owner: "submit the registration without my
  involvement; for ones that require payment, flag them as payment
  required"): `src/adapters/tennis-tc/registrar.ts` signs in with the
  Tennis Canada login from the Accounts page (plain HTTP with a cookie jar,
  2 s apart), opens `/individual-entry/<t>`, picks the form's event that
  matches the search's event by ball colour and age (it won't guess
  between several or across colours), agrees to the regulations and
  submits. The page the site shows next decides the status: "My entry"
  with "Entered" → entered; a pay button, a payment address or "unpaid /
  payment pending" wording → payment_needed ("Payment required" with the
  site's link on the Tennis page); the form coming back with an error →
  left to the owner with the site's message; anything else →
  payment_needed with "check the entry on the site", never counted as
  entered. A tournament already showing "My entry" isn't submitted again.
  The fee from the event's option text goes in the note. "Enter him on the
  site automatically" on the Tennis source's entry settings (on by
  default) switches it off. Without a stored login, entries stay "found"
  with a note saying to add it.

### M4 (slice S4): School (≈ 6 days)
| Task | Description | Spec | Done when |
|---|---|---|---|
| M4.1 | SP-5 Classroom access spike. | F-5 | Works, or a fallback is chosen with the owner. |
| M4.2 | Veracross: school calendar via ICS, or scraping (per SP-4). Timetable scraper for daily periods. | SRC-7, SCH-1, SCH-2, CAL-7 | Fixture tests. The "Today at school" card. Closures appear as banners. School blocks collapse and expand. |
| M4.3 | Classroom adapter (API), or the chosen fallback (guardian emails via EML, or manual). **Deferred by the owner (2026-09-28).** | SRC-8, SCH-3, SCH-4 | Homework with states. Missing and due-in-24 h items highlighted. Grades with a per-course trend. |
| M4.4 | School links back to the source systems; school layer wired into the School toggle. | SCH-5, CAL-3a | e2e test. |

**Build notes (M4, 2026-09-27):**
- M4.1: the spike runs on the live site, not a script. "Connect school
  account (Classroom)" on the Accounts page asks for the two Classroom
  scopes with Google's account chooser (every Google connect now shows
  it), stores the grant as its own credential, and records whether his
  class list can be read, or Google's exact refusal (spikes.md SP-5).
  `classroom.googleapis.com` is enabled in Terraform. The e2e fake
  Google (`tests/e2e/support/fake-oidc.ts`) serves a sliver of the
  Classroom API and has a school account whose admin blocks the app.
- The next migration is 0010 (M3b took 0009).
- M4.2, first part (SCH-1 collapse, no Veracross needed): on a day with
  two or more timed classes, the calendar shows one "School · N classes"
  block from the first class's start to the last one's end
  (`src/domain/school-blocks.ts`). Tapping it expands that day; "Collapse
  school" folds every day back. Expansion lasts for the visit only. The
  block carries the clash marker of any class inside it, and hides with
  the School chip. A single class stays as it is. The e2e calendar weeks
  now start on 2027-12-20, six per project.
- M4.2, school calendar (SCH-2): no Veracross feed for now (spikes.md
  SP-4). A new source kind, `school_dates` ("School key dates (public
  page)"), reads the school's public key dates list: every item becomes an
  all-day event linking back to the page, categorised by the source's
  rules (suggested: "school closed", "no classes", "non-instructional",
  "pro-d" → `school_closure`, the rest `school_class`), with a "leave out"
  list for the other campus's days. Only the listed school year can be
  cancelled, so last year's dates stay. No login, no migration.
- M4.2, timetable (SCH-1, SCH-5): source kind `veracross` with the
  stored parent login, the parent portal link and (with several children)
  the student's first name. The worker signs in with headless Chromium,
  filling whatever username and password fields it finds (one page or two)
  and typing the password once only; the sign-in page itself was never
  inspected (owner's choice). It then reads the next two weeks' weekdays
  from the server-rendered Daily Schedule pages, 2 s apart. Each period is
  a `school_class` event (room as location, teachers in the notes, a link
  back to that day's page). The page has start times only: a period ends
  when a later one starts, the last gets the day's most common length. The
  "Today at school" card above the calendar shows today's periods, or the
  next school day's once today's are over. No migration. Tested against a
  fake portal (`tests/e2e/support/fake-veracross.ts`) with real Chromium.
- M4.2, sign-in code (2026-09-28): the live portal emails a code to a
  browser it doesn't know, with a "remember this device" box. The worker
  now keeps the headless browser's cookies sealed in `credential_sessions`
  (migration 0010, same envelope as credentials, never in the API, rotated
  with the keys), so the session and the remembered device carry over
  between runs. A code is only typed through "Test connection" on the
  Accounts page: the worker waits up to 8 minutes on the code page, sets
  `meta.codeRequestedAt` so the page shows a code box, and reads the code
  the owner types (sealed as a `code` row, deleted once read). It ticks
  "remember this device" and saves the cookies. A sync that meets the code
  page doesn't wait; it says to use Test connection.
- M4.3 deferred (owner, 2026-09-28): homework and grades wait. When they
  resume: SP-5's result (Classroom connect with his school account) is
  still unreported. The fallback is Veracross, now signed in: each child
  has "Upcoming Assignments" and "Classes & Reports", and each Daily
  Schedule period has an `assignments` table. The next migration is 0012.

### M5 (slice S5): Extras (≈ 10 days)
| Task | Description | Spec | Done when |
|---|---|---|---|
| M5.1 | SP-6 Vertex spike. Update the §8 cost estimate in the spec if it differs. Add the separate AI budget alert, filtered on the Vertex AI billing service. | VID, NFR-7 | Note plus measured cost per debate. AI budget in Terraform. |
| M5.2 | Video intake: link form; Google Drive fetch; Google Photos Picker flow; YouTube links saved but marked "not reviewable" (F-3); history list with soft delete. | VID-1, VID-2, VID-4, F-3, F-4 | e2e tests with a stubbed Google. Temp files are always deleted (test). |
| M5.3 | Media prep: segment trim; ffmpeg frame extraction with denser sampling around motion, capped at ~60 frames; timestamps. | §6.3 | Unit tests on a sample clip. |
| M5.4 | LLM clients (Gemini and Claude on Vertex), with structured-output JSON schemas for review, critique, rebuttal, score and combine. Refusal and error handling. Tokens and cost recorded per call. | §6.3, VID-5 | Contract tests with recorded responses. |
| M5.5 | Debate orchestrator: independent reviews → blind, random-order A/B critiques and scores → rebuttals → final scores (self-scores kept separate) → verdict with tie rule → combined review. Single-model mode setting. Background job with progress. | VID-3, VID-3a–3c, VID-3e, VID-5 | Deterministic tests with recorded responses cover winner, tie, conceded-point removal and blinding (no model names in judge prompts). |
| M5.6 | Review page: both reviews, critiques, scores, verdict, agreed and disputed points, combined review; parent vote; scoreboard per sport (judge wins, parent wins, agreement, self-preference, input type). | VID-3c, VID-3d, F-12, F-13 | e2e test. The vote is stored and can't be overwritten. |
| M5.7 | Evaluation with O-9 clips: run debates, owner votes, review cost and quality. Tune prompts (versioned). | F-12 | Results note in spikes.md. Prompts v1 frozen. |
| M5.8 | Gmail adapter (allow-listed senders and labels only). Claude extraction into suggestions with quotes and confidence. Approve or reject queue. | SRC-4, EML-1..3 | Fixture tests. Nothing reaches the calendar without approval (test). |
| M5.9 | Google Calendar copy: create the "Jayden (hub)" calendar and sync one way; switch off with keep or delete. | GCO-1, GCO-2 | Integration test with a stubbed Google API. The household calendar is never written (test). |

**Build notes (M5, 2026-09-28):**
- M5.1 (SP-6, spikes.md): Gemini works on Vertex AI (`gemini-3.1-pro-preview`
  from `global`, video inline with a chosen frame rate, about 66 tokens a
  frame). Claude still gets 429 (quota 0), so the owner has to raise the
  `anthropic-claude-opus` quota before debate mode, email suggestions and
  match explanations can run. Estimated cost per debate: $1.50–2.00 (§8
  unchanged). The AI budget is `google_billing_budget.ai` on the Vertex AI
  billing service; not applied (the owner runs Terraform). Gemini's model
  and location are Terraform variables (`GEMINI_MODEL`,
  `GEMINI_VERTEX_REGION` on the worker).

- M5.2 video intake: the Videos page (menu: Calendar, Tennis, Swimming,
  Videos, Settings) takes a link or "Pick from Google Photos", with sport,
  date filmed, note and an optional segment (up to 2 minutes reviewed).
  The row is saved first (VID-1), then the worker job `video:review <id>`
  starts. Drive links are fetched with `drive.readonly`; Google Photos uses
  the Picker API (`photospicker.mediaitems.readonly`): the worker opens a
  session, the page shows its link, the owner picks, the worker polls (up
  to 15 minutes). Both scopes come from "Connect Google Drive and Photos"
  (feature `videos`, also on the Accounts page); `drive.googleapis.com` and
  `photospicker.googleapis.com` are enabled in Terraform (not applied).
  YouTube and other links are saved as "not reviewable" (F-3); pasted
  Google Photos links are refused with a pointer to the picker (F-4).
  Videos are capped at 400 MB (Cloud Run's temp folder is memory) and the
  temp folder is deleted in a `finally` (tested). Soft delete and restore;
  two finished reviews can be compared side by side (`/videos/compare`).
- M5.3 media prep (`src/worker/video/media.ts`, `src/domain/frames.ts`):
  ffmpeg trims to the segment and re-encodes to H.264 at most 720p without
  sound (480p if still over the inline limit); Gemini gets the clip with 8
  fps for tennis and 4 otherwise (at most ~400 sampled frames). Claude gets
  up to 60 JPEG frames 768 px wide: 1.5 a second, plus 12 a second in the
  one or two 1.2 s windows with the most motion (ffmpeg scene scores),
  each labelled with its time in the original video. CI installs ffmpeg.
- M5.4 clients (`src/server/llm/`): Gemini through `@google/genai` (Vertex,
  `responseJsonSchema`), Claude through `@anthropic-ai/vertex-sdk`
  (adaptive thinking, effort medium, `output_config.format` JSON schema,
  frames marked for prompt caching). One zod schema per step; limits are
  stripped from the JSON schema sent and enforced when parsing; a
  malformed answer is retried once. Refusals, quota (429) and size errors
  become plain-language messages. Tokens and cost are recorded per call
  from `src/server/llm/pricing.ts`. Contract tests replay real Gemini
  answers (`tests/fixtures/llm/video/gemini-*.json`, recorded with
  `scripts/record-video-llm.ts` on a synthetic clip); Claude's fixture is
  hand-written until its quota allows a recording.
- M5.5 debate (`src/server/video/debate.ts`): the §6.3 rounds, the two
  models in parallel per round. Each judge sees Review A/B in its own
  random order, kept for the final scoring; no prompt a judge, author or
  combiner gets names a model (tested). Interpretation of "winner: highest
  average of the two judges' final totals": each review's total is the
  average of both judges' final totals, so each judge's score of its own
  review counts once; that score is also reported as the self-score, and
  self-preference is its gap to the other judge's score of the same
  review (scoreboard). Within 1 point is a tie; the higher average (Gemini
  when equal) writes the combined review. Points an author conceded are
  removed from the combined review even if the model keeps them
  (`dropConceded`, tested). Single-model mode (VID-3e, a setting on the
  Videos page) is round 1 only. `VIDEO_LLM=fake` swaps in scripted models
  for local runs and e2e tests; refused on Cloud Run.
- M5.6 review page (`/videos/[id]`): progress while it runs (polls every
  3 s), the verdict labelled as the AI judges' opinion, the combined advice
  with agreed and disputed points (both sides shown), the vote (once;
  a second vote is a 409), and under "Both reviews…" each review, the
  judges' scores per criterion (self marked), critiques and replies, plus
  calls, cost, model versions and prompt version. The scoreboard (Videos
  page) shows per sport judge wins, parent-vote wins, ties, how often the
  judges agreed with the vote, and each model's self-lean.
- Prompts are `video-1-draft`; M5.7 freezes v1 after the owner's clips.
- The next migration is 0013 (M5 took 0012 for `video_reviews` and
  `video_review_rounds`).

- M5.8 email suggestions: source kind `gmail` ("Coach and club emails")
  with the owner's Google account (feature `gmail`, `gmail.readonly`, a
  restricted scope: fine for the unverified personal app, F-6; button on
  the Accounts page) and an allow-list of senders (`*@club.ca` for a whole
  domain) and Gmail labels, edited when the source is added. The search
  only asks Gmail for those (last 14 days, at most 50), and every message
  is checked against the list again (EML-1). The sync adds no calendar
  records and uses an empty window, so it never cancels anything; each new
  email goes to Claude (`src/server/email/extract.ts`, structured output)
  with the home time zone and the next 60 days' events labelled E1…, and
  comes back as new / change / cancel suggestions with a word-for-word
  quote and per-field confidence (EML-2). Only the sender, subject and the
  suggestions are stored (`email_messages`, `email_suggestions`, migration
  0013); the text is not (§7.2). Each email is read once; if Claude isn't
  available the run fails in words and the emails are read next time.
  Settings → Suggestions (badge with the count) lists them: fields can be
  corrected, "guess"/"implied" marks low-confidence fields, and approving
  a new one adds an event under the email source with the Gmail link as
  its source link (EML-3); a change moves the event it's about and a
  cancellation skips it, both as overrides (CON-3/4), so no source is
  written. `EMAIL_LLM=fake` stands in for Claude locally and in tests.
  The next migration is 0014.

- M5.9 Google Calendar copy: Settings → General "Copy to Google Calendar".
  It uses its own Google grant with only `calendar.app.created` (feature
  `calendar_copy`), so Google itself only lets the site write to calendars
  it created: the household calendar can't be written (GCO-1), and the
  worker also refuses any calendar that is a source or "primary" (tested).
  Job `calendar:copy` creates "Jayden (hub)" in the home time zone on first
  use (again if it was deleted in Google), then copies every active event
  from 30 days back to a year ahead as the calendar shows it (moves
  applied; skipped, cancelled and deleted left out or removed), writing
  only what changed (`calendar_copy_events` keeps each event's Google ID
  and a hash; migration 0014). It runs after the daily `sync all`, when
  switched on, and on "Copy now". Switching off stops updates; "delete the
  copy" runs `calendar:copy delete` (GCO-2). The last run's counts or
  error show on the page. The next migration is 0015.

### M6: Go-live hardening (≈ 2 days; can run after M1 and again after M5)
| Task | Description | Spec | Done when |
|---|---|---|---|
| M6.1 | Security review (`/security-review` plus a manual checklist): auth on every route, CSP, CSRF, secret redaction, KMS IAM split, no public buckets. | NFR-2, F-9 | Findings fixed or accepted in writing. |
| M6.2 | Go-live checklist (spec §9): restore tested, allow-list, noindex, no secrets in logs, 2-step verification on, budgets active, logs regional. | §9, NFR-1a | All items ticked in the PR. |
| M6.3 | Runbook in the README: redeploy, rotate keys, reconnect a source, restore a backup, what to do when an adapter breaks. | NFR-8 | Reviewed by the owner. |

**Build notes (M6, 2026-09-28):**
- M6.1: a manual review of the whole repository and the live project
  ([security-review.md](security-review.md)); `/security-review` reviews a
  branch's changes, not a whole codebase. Fixes: Google access tokens are
  registered with the log redactor where they're minted, and links from
  source data are shown only if they're `http(s)` (`src/lib/external-href.ts`).
- M6.2: the checklist is in the same file; items only the owner can check
  are left unticked.
- M6.3: "Runbook (production)" in the README: redeploy and roll back,
  rotate keys and secrets, reconnect a source, restore (points to
  `infra/README.md`), a broken adapter, and the AI features.

**Total: about 48 engineering days.** S1 is usable on its own after about
16 days (M0 + M1).

---

## 6. Test strategy

| Level | What | Where it runs |
|---|---|---|
| Unit | Clash rules, upsert and override rules, time zones and daylight saving, crypto and redaction, Glicko-2, swim forecast, debate verdict logic | CI, every push |
| Adapter | Each adapter against recorded fixtures (HTML, JSON, ICS, LLM responses) | CI, every push |
| Integration | Repositories and upsert against a real Postgres; job locks; API auth | CI (Postgres service) |
| End-to-end | Sign-in gate, calendar views, toggles, drag and drop (mouse and touch), refresh, credentials, sport pages, review page | CI (Chromium, 375 px and desktop) |
| Live smoke | One real fetch per source using the owner's credentials | On demand (`pnpm smoke <source>`), never in CI |
| Performance | Clash detection benchmark; week view load time on a 4G profile | CI benchmark; Lighthouse before go-live |

Fixtures are refreshed with `pnpm fixtures:record <source>`. Personal data in
fixtures is replaced with fake names before commit (a scrubber script plus a
review step), because the repository must never hold real data about Jayden
or his opponents.

---

## 7. Risks during the build

| Risk | Likelihood | Mitigation |
|---|---|---|
| A source site changes its pages | High, over time | Isolated adapters, fixture tests, readable errors, manual entry fallback (SYNC-6). |
| A source site blocks automated login | Medium | Low request rate. On block, pause the adapter and fall back to manual entry. The owner decides whether to ask the site for an export. |
| The school blocks the Classroom API | Medium | SP-5 first; fallbacks already agreed (F-5). |
| A Vertex model or region isn't available in Canada | Medium | SP-6 early. Processing outside Canada is allowed by NFR-1a; storage never leaves Canada. |
| Debate cost higher than estimated | Medium | Measured in SP-6. Single-model mode. AI budget alert. |
| Real personal data leaks into the repo through fixtures | Medium | Scrubber script, PR checklist item, secret and PII scan in CI. |
| Scope creep | Medium | New ideas become `intent/0002-…`, not changes to this plan. |

---

## 8. Traceability

| Spec area | Tasks |
|---|---|
| AUTH-1..4 | M0.8, M1.1 |
| CAL-1..9, CAL-3a | M1.4, M1.8, M1.9, M1.11, M4.2, M4.4 |
| CON-1..6 | M1.4, M1.9, M1.10 |
| SYNC-1..6 | M1.4, M1.5, M2.7, M3.7 |
| SRC-1..10 | M1.6, M1.7, M2.3, M3.3, M4.2, M4.3, M5.2, M5.8 |
| TEN-1..8 | M3.1–M3.7 |
| TEN-9..11 | M3b.1–M3b.7 |
| SWM-1..7 | M2.1–M2.7 |
| ACT-1..2 | M1.6, M1.9, M1.10 |
| SCH-1..5 | M4.1–M4.4 |
| VID-1..5, VID-3a–3e | M5.1–M5.7 |
| EML-1..3 | M5.8 |
| CRED-1..7 | M1.2, M1.3 |
| GCO-1..2 | M5.9 |
| NFR-1..9, NFR-1a | M0.3, M0.6, M0.8, M1.1, M1.8, M1.9, M1.12, M1.13, M6.1, M6.2 |
| F-1..F-13 | Spikes SP-1..SP-6, and the tasks named in each concern's handling |

---

## 9. Status

| Milestone | Status |
|---|---|
| M0 Skeleton and infrastructure | **done 2026-09-27.** Infrastructure applied in Toronto; first deploy green (images, `migrate`, web, smoke test). DNS points at Firebase Hosting. SP-1 done. |
| M1 Foundation (S1) | **deployed 2026-09-27** (PRs #3, #8–#11). M1.13 restore test done by the owner (2026-09-28). Still open: M1.6 live smoke test and M1.7 Spordle decision (need the owner's feed links, O-6). |
| M2 Swimming (S2) | **done 2026-09-27** (M2.1–M2.7, PRs #14–#16). The owner's live check passed. SP-3 page map in spikes.md. |
| M3 Tennis (S3) | **done 2026-09-28** (M3.1–M3.7, PRs #17, #18). M3.3 live check passed: the tennis source syncs in production and the owner confirmed it (2026-09-28). Still open: M3.6 recorded Claude response (waiting on the Vertex quota); O-5 signed-in look done (spikes.md SP-7). |
| M3b Tournament entries | **merged 2026-09-27** (PR #21). Finding, acceptance lists, draw watch, opponent level done. M3b.6 automatic entry built 2026-09-28 (`m3b/6-auto-entry`); needs the Tennis Canada login on the Accounts page, then the first Thursday run is the live check. |
| M4 School (S4) | **deployed 2026-09-28** (PRs #22–#31). M4.1 Classroom connect and check built; the spike itself (consent with his school account) waits on the owner. M4.2 school blocks, key dates, Veracross timetable with sign-in codes: live. M4.3 (homework and grades) deferred by the owner. M4.4 links done. |
| M5 Extras (S5) | **merged 2026-09-28** (PRs #32–#35; Terraform applied). M5.1–M5.6, M5.8, M5.9 built; video reviews work live in Gemini-only mode. Open: the Claude quota (debate mode, email suggestions, match explanations), M5.7 evaluation with the owner's clips (prompts still `video-1-draft`), SP-6's real-clip run, connecting Gmail and the calendar copy. |
| M6 Go-live hardening | **done 2026-09-28 except owner items** (`m6/go-live`). M6.1 review in [security-review.md](security-review.md): two fixes, five accepted risks for the owner to confirm. M6.2 checklist there: owner confirms the allow-list's second address, 2-step verification and budgets. M6.3 runbook in the README, for the owner to review. |

Between M3 and M4 (2026-09-27): Sources, Accounts, Clashes and Deleted
moved under Settings as tabs (`/settings/sources` and so on); the old
paths redirect (307). The main menu is Calendar, Tennis, Swimming and
Settings, with the open-clash count on Settings and on its Clashes tab.
The Google connect flow (`/accounts/google/*`) keeps its path, since the
redirect URI is registered with Google.

Page fixes (owner, 2026-09-28): the calendar has a Refresh button next to
"+ Add event" that syncs every source (SYNC-2; new events arrive through
the live updates). Tennis "Upcoming tournaments" is a table (tournament,
date, venue, status, opponent and time, prediction) that includes every
tournament he's registered for from `tennis_entries`, before the
acceptance list or draw is out (status: registered, main draw, reserve
list (place)); "Found for him" keeps only the ones he isn't registered
for. Swim entries keep the meet day and session start Commit Swimming
sends (migration 0011; the next is 0012), and upcoming meets show the
session date and time. The PB table lists the newest PB first within each
course.

Refresh (owner, 2026-09-28): only a successful run starts the hour's wait
(SYNC-5), so a failing source can be retried at once; the advisory lock
still stops overlapping runs. A refused refresh says why on its own source
card, with the next possible time in local time, and an open History
follows new runs.

CI (2026-09-28): the checks run once per change. A PR run leaves a
`ci-tree-<git tree>` marker when everything passes; the run on `main`
after the merge skips the checks when the merged files are the same, and
runs them in full otherwise. Deploy caches Docker layers in the registry
(`cache:web`, `cache:worker`), Chromium is cached per lockfile, and types
are checked by `pnpm typecheck` only (`next build` skips them).

Clash rule (owner, 2026-09-28): two events clash only when they overlap
by more than 15 minutes (`CLASH_TOLERANCE_MIN`). Back-to-back events and
short overlaps don't clash, and there are no travel-time clashes any
more: clash detection no longer reads `locations` or `location_buffers`
(the tables and seed rows stay for now). Each clash carries its overlap in
minutes, shown on the clash list and event detail. Settings > General
builds the time zone list on the server, so it matches on hydration.

Entries made by hand (owner, 2026-09-28): a tournament he was entered in
outside the app (by hand, or before the entry jobs first ran) didn't show
under Upcoming, because the Thursday search only asks for "entry open"
tournaments and his profile doesn't list a tournament until he's played
there. `tennis:enter` and `tennis:acceptance` now also search every Rookie
tournament near home in the next 28 days, open or closed (the search's
`TournamentFilter.StartDate`/`EndDate`), read each event's entry list,
and record the ones he's on with main draw or reserve status. The
acceptance job's request cap is 100 (was 60).

Whose event (owner, 2026-09-28): a parent's own appointment on the family
calendar (e.g. Lei's dentist) shouldn't clash with Jayden's day. The event
detail has a "Jayden's attendance" menu on every event. For events from a
source or a series it's saved on the override (`event_overrides.attendance`,
migration 0015; the next is 0016), so it survives syncs, and "Use the
source's time" keeps it. Events added here change directly.

Household duplicates (owner, 2026-09-28): the family calendar often
repeats an event a dedicated source has (e.g. "Jayden soccer" next to the
TeamSnap game). The dedicated source is the truth: `loadCalendar` leaves
out a household (`google_calendar`) event when a non-household source has
one of the same category (not "other") that overlaps it by at least half
the shorter event, or, for all-day events, shares a date
(`src/domain/duplicates.ts`). Nothing is stored or deleted; the household
event is just not shown, not clashed and not copied to Google. The two
events must also share an owner (see Owners below).

Owners (owner, 2026-09-28): every event belongs to one or more people,
replacing the School/Activities chips (CAL-3a) and "parent only"
attendance (CON-1). `people` (migration 0018) holds them; exactly one is
primary (Jayden, seeded by 0019), and an event with no owners is his.
`events.owner_ids`, `event_series.owner_ids` and `event_overrides.owner_ids`
hold `people.id`s; a change to a synced event is an override, like
attendance. A source's mapping has default `owners` and rules can name a
person ("(Lei) = Lei"), applied at sync by `ownersFor` in the worker.
A person named in the title as a whole word ("Jayden swimming", "Lei's
dentist") also owns it (owner, 2026-09-29); with neither, the source's
default owners apply, and none means Jayden;
owners count in the record hash only when set, so existing events kept
their hash. Clashes are per person (`Clash.people`), the Google copy holds
the primary person's events only, and removing a person takes them off
every event and source. 0019 is a custom migration (`db:generate --custom`):
it turns `parent_only` into `optional` and drops rules that only said
"parent only", before 0020 narrows the attendance check. People are added
under Settings > General; each source's categories and owners are edited
from its card ("Categories and owners"). The next migration is 0021.
