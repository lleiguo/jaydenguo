# Spec: Jayden's schedule and progress hub (jaydenguo.com)
Source: [intent.md](intent.md) (approved 2026-09-26). Status: draft for review.
Owner: Jayden's parent (lleiguo). Written by Claude, reviewed by the owner.

This spec turns the approved intent into requirements and a design that a
`plan.md` can be built against. Every requirement has an ID and acceptance
criteria. Section 10 lists **flagged concerns**: places where the intent
cannot be met as written, or only with a trade-off the owner must accept.

---

## 1. Scope

### In scope (v1)
- A private web app at `jaydenguo.com`, mobile-first, behind login.
- A combined calendar of every activity, school timetable and school closures,
  with clash detection and drag-and-drop resolution.
- Tennis: tournaments, draws, opponents, head-to-head, opponent form, predictions.
- Swimming: meets, entries, results, personal-best progression, forecasts.
- Soccer, hockey, math, Chinese, fitness: schedule only.
- School: Veracross daily timetable, school calendar, Google Classroom
  homework and grades.
- Technique review of linked videos (no uploads), with a permanent history.
- Connected accounts with encrypted credential storage.
- Daily automatic sync plus on-demand sync (all sources or one).
- Suggested events extracted from coach and club emails, approved by the parent.
- One-way copy of events to a Google Calendar.

### Out of scope (v1)
- Direct video upload or video storage.
- Writing back to source systems: no rebooking with clubs, no messages to coaches.
- Logins for anyone except the owner, and user roles. Only the owner uses the site.
- Native mobile apps. v1 is a mobile-first web app that can be installed to
  the home screen (PWA). A native iOS/Android app is a candidate for later
  (see §1.1).
- Push notifications. A daily email digest is a candidate for v2.

### 1.1 Mobile app decision
v1 ships as a PWA, not a native app. It works on any phone from one codebase,
needs no app-store review, and covers the core use: checking the calendar and
resolving clashes on the go. A native app becomes worth it mainly for
reliable push notifications, home-screen widgets ("today's schedule") and
offline use. To keep that door open, all data goes through a documented JSON
API (not UI-only server actions), so a later React Native/Expo app can reuse it
unchanged. Revisit after S1–S3 are in use; it would be its own intent.

### Delivery slices (recommended order for plan.md)
| Slice | Contents | Why this order |
|---|---|---|
| S1 Foundation | Hosting, domain, login, database, credential vault, sync framework, calendar UI, manual events, household Google Calendar and iCal feeds, clash detection, drag and drop | Delivers the core "don't drop the ball" value on its own |
| S2 Swimming | Commit Swimming sync, meets, entries, results, progression charts, forecast | Well-structured data, lowest risk |
| S3 Tennis | Tennis Canada tournament site sync, draws, head-to-head, opponent form, predictions | Needs the most scraping |
| S4 School | Veracross timetable and calendar, Google Classroom | Depends on school admin settings (see F-5) |
| S5 Extras | Video review, email-to-event suggestions, Google Calendar copy | Independent add-ons |

---

## 2. Users and access

| ID | Requirement | Acceptance criteria |
|---|---|---|
| AUTH-1 | Only allow-listed people can sign in, with Google sign-in. | An account not on the allow-list gets "not authorised" and sees no data. The allow-list initially holds only the owner's Google account. |
| AUTH-2 | Every page and API route requires a valid session. | An unauthenticated request to any route returns a redirect or 401. Automated tests cover every route. |
| AUTH-3 | Search engines and link previews reveal nothing. | `robots.txt` disallows everything. Pages send `noindex`. The login page has no name, photo or other detail about Jayden. |
| AUTH-4 | Sessions last 30 days on a trusted device and can be revoked. | "Sign out everywhere" ends all sessions within 1 minute. |

---

## 3. Functional requirements

### 3.1 Combined calendar (CAL)
| ID | Requirement | Acceptance criteria |
|---|---|---|
| CAL-1 | One calendar shows every event from every source, color-coded by category. | Categories: tennis, swimming, soccer, hockey, math, Chinese, fitness, school class, school closure, other. Each has its own color and icon, so they are distinguishable without color (accessibility). |
| CAL-2 | Day, week, month and agenda views. Agenda is the default on phones. | Views switch without a page reload. The week view is usable at 375 px wide. |
| CAL-3 | Filter by category and by source. | Filters persist per device. |
| CAL-3a | Quick toggle between **School** and **Activities** layers on the combined calendar. | Two toggle chips always visible above the calendar: "School" (classes, homework due dates, school calendar events) and "Activities" (all sports and classes). Either can be shown or hidden with one tap, and both can be on at once. Closure-day banners stay visible even when School is hidden. Clash highlighting still counts hidden events, and a hidden clashing event shows as a "clash with a hidden event" marker. The choice persists per device. |
| CAL-4 | Every event shows where it came from and when it was last synced. | The event detail shows source name, last sync time, and a link to the source page when one exists. |
| CAL-5 | The owner can create, edit and delete manual events, including repeating ones. | Repeat rules support weekly, every N weeks, and date-range limits. Edits take effect immediately. |
| CAL-6 | Events are kept forever. | No event row is ever hard-deleted. A source event that disappears is marked `cancelled` and stays visible in history. A manual delete sets `deleted_at`, and the event can be restored from a "Deleted" view. Every change is written to an event revision history. |
| CAL-7 | School closure days appear as all-day banners. | Closure days come from the school calendar feed (SCH-2). Activities on those days are not clashes, but they are marked "school closed". |
| CAL-8 | Other open devices see changes within 10 seconds. | Change on phone A, and phone B shows it within 10 s without a manual refresh. |
| CAL-9 | Times are stored in UTC and shown in the home time zone (a setting). | Events that cross a daylight-saving change show the correct local time. |

### 3.2 Clash detection and resolution (CON)
| ID | Requirement | Acceptance criteria |
|---|---|---|
| CON-1 | Two events clash when both need Jayden and their times overlap, including a travel buffer. | The buffer comes from the event's location, or defaults to 15 min. It can be set per location, e.g. "tennis club to pool = 30 min". Events marked `optional` or `parent-only` never clash. School class periods clash with activities on school days, but not on closure days. |
| CON-2 | Clashes are highlighted everywhere. | Clashing events get a red outline and a warning icon in every view. A "Clashes" badge shows how many upcoming clashes there are (next 60 days). A clash list page shows each pair. |
| CON-3 | Drag and drop to resolve. | Dragging an event to a new time or day saves a local override, re-runs clash detection straight away, and clears the highlight if the clash is gone. Undo is available for 10 s. Works with touch on phones (long-press to drag). |
| CON-4 | Other ways to resolve: "skip this one" (Jayden won't attend) and "accept clash" (for example, leaving early). | Both clear the highlight. Both are recorded with who did it and when, and can be undone. |
| CON-5 | A local override survives the next sync. | When the source changes an overridden event, the override is kept and the event gets a "source changed since you moved this" badge, with both versions shown. |
| CON-6 | Resolving a clash only changes this site. | Nothing is written back to the source systems (assumption from intent). |

### 3.3 Sync framework (SYNC)
| ID | Requirement | Acceptance criteria |
|---|---|---|
| SYNC-1 | Every source syncs automatically once a day, early morning in the home time zone. | A run history per source shows start, end, status, and items added, changed and cancelled. |
| SYNC-2 | On-demand sync for all sources or a single source. | A "Refresh" button on the sources page and on each sport page starts a sync. Progress is shown live. Most sources finish in under 2 minutes. A second refresh of the same source while one is running is ignored. |
| SYNC-3 | Syncs never duplicate events and are safe to re-run. | Each source event has a stable external ID. Running a sync twice in a row changes nothing the second time. |
| SYNC-4 | Failures are visible. | A failed source shows a red status with the error in plain language, e.g. "Login failed: check your Tennis Canada password". Three failures in a row send an email to the owner. |
| SYNC-5 | Syncs are polite to source sites. | At most one run per source per hour (on-demand included). At least 2 s between page requests. One user-agent that identifies the app. |
| SYNC-6 | Every source can also be filled in by hand. | If a source can't be synced, the owner can still add its events, results and matches manually in the same format. |

### 3.4 Sources and integrations (SRC)
| ID | Source | Data | Method | Auth |
|---|---|---|---|---|
| SRC-1 | Household Google Calendar | Hand-managed family events | Google Calendar API, read | Owner's Google OAuth |
| SRC-2 | TeamSnap | Team schedule (soccer/hockey, per the owner's mapping) | Team iCal subscription URL. Fallback: TeamSnap API. | iCal URL treated as a secret |
| SRC-3 | Spordle | Team schedule | Calendar subscription URL if Spordle offers one. Fallback: scrape with the owner's login. | Stored credentials |
| SRC-4 | Coach and club emails | Candidate events | Gmail API, read-only, limited to allow-listed senders and labels | Owner's Google OAuth |
| SRC-5 | Tennis Canada tournament site (`tc.tournamentsoftware.com`) | Tournaments, entries, draws, match results; opponents' profiles and results | Headless-browser scraping of pages the owner can see | Stored credentials |
| SRC-6 | Commit Swimming (`team.commitswimming.com`) | Meets, entries, results, training schedule if present | Headless-browser scraping | Stored credentials |
| SRC-7 | Veracross parent portal | Daily timetable, school calendar, closures | Calendar subscription (iCal) where offered. Scrape the timetable. | Stored credentials |
| SRC-8 | Google Classroom | Courses, homework, due dates, grades | Classroom API | Jayden's student Google account, OAuth (see F-5) |
| SRC-9 | Math, Chinese, fitness providers | Class schedule | Household calendar, a provider iCal link, or manual repeating events | Depends on the provider |
| SRC-10 | YouTube, Google Photos, Google Drive | Videos for review | See VID-2 and F-3 | Owner's Google OAuth |

### 3.5 Tennis (TEN)
| ID | Requirement | Acceptance criteria |
|---|---|---|
| TEN-1 | Training schedule appears on the calendar under tennis. | Comes from the household calendar, a club feed or manual repeating events. |
| TEN-2 | A tournament list: upcoming, in progress and past. | Each shows name, venue, dates, draws entered, entry status and a link to the source page. Upcoming tournaments appear on the calendar as multi-day events. |
| TEN-3 | Draw and next opponent. | When a draw is published, the page shows his position in the draw and his next opponent (or "winner of A vs B"), with scheduled match times when the site publishes them. |
| TEN-4 | Head-to-head. | For each opponent: every past meeting found on the source, with date, event, round and score. The summary is the W–L record. |
| TEN-5 | Opponent form. | The opponent's last 10 matches (result, score, opponent), their win rate over the last 12 months, and their ranking if shown. |
| TEN-6 | Match prediction. | A win probability for Jayden and a likely score band. The confidence (low, medium, high) depends on how much data there is. A "why" line lists the inputs (ratings, head-to-head, recent form). Labelled "Estimate, not a certainty". Method in §6.1. |
| TEN-7 | Results history. | All his matches, with a filter by season and a running W–L. |
| TEN-8 | Real-time edits. | The owner can enter or correct a score or a match time, and it shows at once. A manual correction is never overwritten by a sync. It is flagged if the source disagrees. |

### 3.6 Swimming (SWM)
| ID | Requirement | Acceptance criteria |
|---|---|---|
| SWM-1 | Training schedule appears on the calendar under swimming. | Comes from Commit Swimming if it publishes practices, otherwise the household calendar or manual events. |
| SWM-2 | Meet list: upcoming and past. | Name, venue, dates, pool course (SCM/LCM/SCY) and entered events with seed times. Meets appear on the calendar. |
| SWM-3 | Results per meet. | For each swim: event, time, place, splits if available, whether it was a PB, and the change from his previous best. |
| SWM-4 | Progression per event. | A chart per event and course, e.g. 200 IM LCM. It plots every swim, with the PB line stepping down over time. SCM and LCM are never mixed on one line. A conversion toggle is optional (v2). |
| SWM-5 | Forecast per event. | For events with at least 4 results, a projected time in 6 and 12 months, with a range band, labelled "Estimate". Method in §6.2. |
| SWM-6 | PB table. | His current best for every event and course, with date and meet. |
| SWM-7 | Real-time edits. | The owner can add or correct a result. The same rule as TEN-8 applies. |

### 3.7 Soccer, hockey and classes (ACT)
| ID | Requirement | Acceptance criteria |
|---|---|---|
| ACT-1 | Schedules for soccer, hockey, math, Chinese and fitness appear on the calendar. | Each is mapped to a source (SRC-1/2/3/9) on the sources page. |
| ACT-2 | Clash detection and drag and drop apply to them, same as CON-1..6. | — |

### 3.8 School (SCH)
| ID | Requirement | Acceptance criteria |
|---|---|---|
| SCH-1 | Daily timetable. | A "Today at school" card shows periods, classes, rooms and teachers from Veracross. The calendar shows school blocks, collapsed into one "School" block by default and expandable. |
| SCH-2 | School calendar. | Closures, early dismissals, PD days and events from the school calendar feed. Closures follow CAL-7. |
| SCH-3 | Homework. | Classroom assignments with course, title, due date and status (assigned, turned in, late, missing). Upcoming due dates appear in the agenda. "Missing" and "due in 24 h" are highlighted. |
| SCH-4 | Grades and quizzes. | Returned grades per course, shown as score and percentage with a simple trend per course. |
| SCH-5 | Links. | Every item links back to Classroom or Veracross. |

### 3.9 Technique review from video links (VID)
| ID | Requirement | Acceptance criteria |
|---|---|---|
| VID-1 | Submit a video link for any sport, with a short note (e.g. "second serve, focus on toss"). | The form takes a URL, sport, date filmed (defaults to today) and note. The link is saved before any analysis runs. |
| VID-2 | Supported sources: Google Drive links and Google Photos (through the Google Photos picker). YouTube: see F-3. | The site fetches private videos through the owner's connected Google account. The video is streamed or temp-downloaded, processed, then deleted. Nothing is kept after the review. |
| VID-3 | The review. | Sections: what's good, what to fix (ranked by impact), 1–3 drills, and what to film next time. Each point references a time in the video where possible. The review is framed for a 9-year-old's development stage. Labelled as AI feedback, not a coach's assessment. Method in §6.3. |
| VID-4 | History kept until the owner deletes it. | A list per sport, newest first: link, note, date, status (queued, analysing, done, failed) and the review. Old reviews can be compared side by side. |
| VID-5 | Reviews run in the background. | The page shows progress. Failures give a readable reason (e.g. "Can't open this link. Is the Google account still connected?"). |

### 3.10 Suggestions from email (EML)
| ID | Requirement | Acceptance criteria |
|---|---|---|
| EML-1 | Read only allow-listed senders or labels. | The owner manages the list, e.g. `*@teamsnap.com`, a coach's address, a Gmail label "Jayden". Nothing else is fetched. |
| EML-2 | Extract candidate events, changes and cancellations with Claude. | Each suggestion shows the extracted fields and a quote from the source email. Low-confidence fields are marked. |
| EML-3 | The parent approves or rejects each suggestion. | Nothing from email reaches the calendar without approval. Once approved, it is an event with source `email` and a link to the message. |

### 3.11 Connected accounts and credentials (CRED)
| ID | Requirement | Acceptance criteria |
|---|---|---|
| CRED-1 | A "Connected accounts" page lists every source with its status. | Status: connected, needs attention or not connected. Shows last successful use. |
| CRED-2 | Use Google OAuth where possible, and a username/password only for sites without OAuth. | Google sources (Calendar, Gmail, Classroom, Photos, Drive, YouTube) use OAuth, and only refresh tokens are stored. Tennis Canada, Commit Swimming, Veracross and Spordle use stored logins. |
| CRED-3 | Encrypted at rest. | Envelope encryption (§7.3). The database holds only ciphertext. The key lives outside the database. |
| CRED-4 | Never shown back in full. | Password fields are write-only. The UI shows `••••` and "last updated on …". The API has no read path for secrets. |
| CRED-5 | Never written to logs. | Structured logging redacts known secret fields. A test proves a sync-run log contains no secret values. |
| CRED-6 | Update, test and remove. | "Test connection" checks a login without running a full sync. "Remove" deletes the ciphertext and revokes the OAuth token. |
| CRED-7 | Audit. | Every credential create, update, use and delete is logged with time and actor (no values). |

### 3.12 Google Calendar copy (GCO)
| ID | Requirement | Acceptance criteria |
|---|---|---|
| GCO-1 | One-way copy to a dedicated "Jayden (hub)" Google Calendar that the site creates. | The copy never writes to the household calendar. That prevents sync loops, because the household calendar is also a source. |
| GCO-2 | Can be switched off. | Switching it off stops updates. The owner chooses to keep or delete the copied calendar. |

---

## 4. Non-functional requirements

| ID | Area | Requirement |
|---|---|---|
| NFR-1 | Privacy | Data about Jayden goes only to: Google Cloud (hosting, database, storage, all in Canada), Google (through the owner's own accounts), and the Anthropic API for video review, email extraction and match summaries. No analytics or ad trackers. No third-party scripts in pages. |
| NFR-1a | Data residency | All stored data (database, backups, logs, container images) stays in Google Cloud regions in Canada. Calls to Google's own APIs and the LLM for processing are the only data leaving Canada, and nothing is stored there. |
| NFR-2 | Security | HTTPS only with HSTS. Strict CSP. CSRF protection on mutations. Dependencies scanned in CI. Rate limiting on login. The owner's Google account must have 2-step verification (checklist item). |
| NFR-3 | Durability | Nightly encrypted database backup to separate object storage, kept 1 year, plus the provider's point-in-time restore (7 days minimum). A restore is tested once before go-live. |
| NFR-4 | Performance | Calendar week view loads in under 2 s on 4G. Clash detection over 2 years of events runs in under 200 ms. |
| NFR-5 | Mobile | Mobile-first layouts at 375 px and up. Touch drag and drop. Installable as a PWA. |
| NFR-6 | Availability | Best effort. Downtime is acceptable. A sync failure must never corrupt or delete existing data. |
| NFR-7 | Cost | Target under US$40/month for Google Cloud, plus LLM usage (estimate in §8). A budget alert enforces it. |
| NFR-8 | Maintainability | One repository in one language (TypeScript). Each source integration is an isolated adapter with recorded-fixture tests, so a site change breaks one adapter, not the app. |
| NFR-9 | Accessibility | WCAG 2.1 AA for colour contrast, keyboard use and screen-reader labels. Drag and drop has a non-drag alternative ("Move to…" menu). |

---

## 5. Architecture (Google Cloud)

Everything runs in one Google Cloud project in the Toronto region
(`northamerica-northeast2`). All data must stay in Canada (owner decision,
2026-09-26). Montréal (`northamerica-northeast1`) is the only allowed fallback
for any service that isn't available in Toronto.

```
 Browser (PWA) ──HTTPS──▶ jaydenguo.com
                           │  Firebase Hosting (custom domain + managed TLS),
                           │  rewrites all requests to Cloud Run
                           ▼
                 ┌───────────────────────────┐   Run Jobs API    ┌──────────────────────────┐
                 │ Cloud Run service: web    │──(on-demand)─────▶│ Cloud Run jobs: worker   │
                 │ Next.js UI + JSON API     │                   │ same image, one task per │
                 │ Auth.js (Google sign-in)  │                   │ run: sync:<source>,      │
                 └──────┬──────────┬─────────┘                   │ review:<video>, backup   │
                        │          │ encrypt only                │ Playwright, ffmpeg,      │
                        │          ▼                             │ Google APIs, iCal, LLM   │
                        │   ┌─────────────┐   decrypt only       └──┬───────────┬───────────┘
                        │   │ Cloud KMS   │◀────────────────────────┘           │
                        │   │ (key for    │                                     │
                        │   │ credentials)│      Cloud Scheduler ──daily──▶ worker jobs
                        │   └─────────────┘                                     │
                        ▼                                                       ▼
                 ┌──────────────────────────────┐  nightly export  ┌──────────────────────┐
                 │ Cloud SQL for PostgreSQL 16  │─────────────────▶│ Cloud Storage bucket │
                 │ auto backups + PITR (7 days) │                  │ (Canada, 1-year      │
                 └──────────────────────────────┘                  │ retention lock)      │
                                                                   └──────────────────────┘
  Secret Manager: OAuth client secrets, Auth.js secret, LLM API keys
  Cloud Logging + Monitoring: logs (secrets redacted), sync-failure alerts, budget alerts
```

| Decision | Choice | Reason |
|---|---|---|
| Language | TypeScript everywhere | One language for UI, API and scrapers. Playwright and the Google and Anthropic SDKs are all first-class in TypeScript. |
| Web framework | Next.js (App Router) | Server rendering, API routes and auth in one project. |
| Calendar UI | FullCalendar (standard, MIT) | Mature day, week, month and list views, and drag and drop with touch support. |
| Charts | A light chart library (e.g. Recharts) | Progression and trend charts. |
| API | Documented JSON API (REST, typed with OpenAPI) used by the web UI | Lets a future native app reuse the same backend (§1.1). |
| Web hosting | Cloud Run service, scales to zero | Pay only while in use. A cold start adds about 1–3 s to the first load after a quiet period. Setting min instances to 1 removes that, for a few dollars a month (owner's choice). |
| Domain and TLS | Firebase Hosting in front of Cloud Run | Free managed certificate for `jaydenguo.com`, with no load balancer to pay for. DNS stays at the current registrar (A/TXT records). |
| Background work | Cloud Run jobs (one image with Chromium and ffmpeg), started by Cloud Scheduler daily and by the web app for on-demand refresh and video reviews | Needs no always-on worker. Each source runs as its own job, so one broken site can't block the others. |
| Job state and locks | `sync_run` table plus a Postgres advisory lock per source | Stops two refreshes of the same source running at once (SYNC-2). No separate queue service. |
| Database | Cloud SQL for PostgreSQL 16, smallest shared-core size, automated daily backups and 7-day point-in-time restore | Managed, in-region, and fits the data size (well under 10 GB for years). |
| DB connection | Cloud SQL Node.js connector with IAM database auth. No authorised networks. | No database passwords, and no open IP. |
| Credential key | Cloud KMS key (§7.3). The web service account can only encrypt; the worker service account can only decrypt. | IAM enforces "web writes, never reads" (CRED-4). |
| App secrets | Secret Manager, mounted into Cloud Run | Kept out of the repo and out of images. |
| Backups | Cloud SQL backups plus a nightly export to a Cloud Storage bucket with a 1-year retention policy | Meets NFR-3, and a mistake in the database can't delete the exports. |
| Live updates | The browser polls a small "changes since" endpoint every 10 s while the page is open and visible | Meets CAL-8, and works with Cloud Run scaling to zero. |
| Auth | Auth.js with Google provider and an email allow-list | Reuses the owner's Google account. No passwords of our own. |
| Build and deploy | GitHub Actions builds images, pushes them to Artifact Registry and deploys to Cloud Run. Authenticates with Workload Identity Federation, so no service-account keys. | Nothing long-lived is stored in GitHub. |
| Infrastructure setup | Terraform in `infra/` | The whole project can be recreated and reviewed as code. |
| Cost guardrails | A Cloud Billing budget with alerts at 50/90/100% of the monthly target | Catches runaway LLM or database costs early. |
| LLM | Anthropic Claude API, model `claude-opus-5` | Vision for video frames, extraction for emails, short prediction summaries. |

### 5.1 Sync flow
1. Cloud Scheduler (daily) or the owner (on-demand) starts a worker job for
   `sync:<source>`. The job takes that source's advisory lock, or exits if
   the source is already running.
2. The adapter asks KMS to decrypt its credentials, keeps them in memory only,
   fetches data and maps it to a normalised shape with a stable `external_id`.
3. The upsert step compares with the stored rows. It inserts new rows, updates
   changed ones (writing a revision), and marks missing ones `cancelled`.
   Rows with a local override or a manual correction are not overwritten
   (CON-5, TEN-8).
4. Clash detection re-runs for the affected date range.
5. The run record is saved. Open browsers pick up the changes on their next
   poll.

### 5.2 Local development
- **Start-up:** `docker compose up` starts Postgres 16, matching Cloud SQL.
  `npm run dev` starts the web app. `npm run job -- sync:<source>` runs any
  worker job locally, the same code Cloud Run runs.
- **Schema:** migrations are versioned in the repo and are the only way the
  schema changes. The same migrations run locally, in CI and in production.
- **Seed data:** `npm run seed` loads a realistic fake season (events with a
  few clashes, tennis matches, swim results, homework). The app is usable
  without connecting any real account.
- **No production secrets locally:**
  - Local encryption uses a local development key instead of KMS, behind the
    same interface.
  - Source adapters run against recorded page fixtures by default. Live mode
    is opt-in, with the owner's login in a git-ignored `.env.local`.
  - LLM calls use recorded responses by default. Live mode is opt-in, with a
    low-limit key.
  - Google APIs use a separate dev OAuth client that redirects to `localhost`.
- **Dev sign-in:** a dev-only login shortcut. It is disabled in production
  builds, and a CI check confirms it's off.
- **Environments:** local, CI (GitHub Actions with a Postgres service
  container) and production. There is no staging environment in v1.
- **Acceptance:** a new machine goes from `git clone` to a running app with
  seed data in under 10 minutes, following the README.

---

## 6. Prediction, forecast and review methods

### 6.1 Tennis match prediction
- **Data:** all matches found for Jayden, his upcoming opponents, and their
  opponents (one hop), from the tournament site. Refreshed daily.
- **Model:** a Glicko-2 rating per player, computed over that match set. The
  win probability comes from the rating difference. It is adjusted slightly
  by head-to-head record, recent form (last 10) and a margin-of-victory
  factor from games won.
- **Confidence:** from the ratings' uncertainty (RD) and how many matches each
  player has. Fewer than 5 rated matches for either player gives "low".
- **Explanation:** a one-paragraph plain-language summary written by Claude
  from the computed numbers only. Claude does not choose the probability.
- **Check:** backtest on past matches in the data set. Show the calibration
  (e.g. "matches we called 70% were won 68% of the time") on a small "How
  accurate is this?" page.

### 6.2 Swim time forecast
- **Data:** every result for the event and course.
- **Model:** fit the PB series against age with a curve whose improvement
  slows over time (exponential decay toward an asymptote). Use robust fitting
  so outliers (e.g. a DQ'd or sick swim) don't skew it. Forecast at +6 and +12
  months, with a range from the residuals.
- **Guardrails:** only with at least 4 results over at least 6 months.
  Forecasts are never shown faster than the fitted asymptote. Always labelled
  "Estimate". Growth spurts at this age make forecasts uncertain, and the UI
  says so.

### 6.3 Video technique review
- The Claude API takes images, not video files. The worker fetches the video
  through the owner's connected account and extracts frames with ffmpeg. It
  uses about 1–2 frames per second, capped at about 60 frames, with denser
  sampling around motion. Each frame is timestamped.
- It sends the frames, the sport, the owner's note and a sport-specific rubric
  (e.g. tennis serve: stance, toss, trophy position, contact, follow-through;
  freestyle: body line, catch, rotation, kick, breathing) to `claude-opus-5`.
  The reply comes back in a fixed structure (VID-3).
- Temp files are deleted when the job finishes, whether it succeeded or failed.

---

## 7. Data and security design

### 7.1 Main entities
| Entity | Key fields |
|---|---|
| `user` | id, email |
| `source` | id, kind (google_calendar, ical, teamsnap, spordle, gmail, tennis_tc, commit_swim, veracross, classroom, …), category mapping, enabled, schedule |
| `credential` | id, source_id, kind (oauth, password, secret_url), ciphertext, wrapped_dek, key_version, updated_at, last_used_at |
| `sync_run` | id, source_id, trigger (scheduled/manual), status, counts, error_message, started_at, finished_at |
| `event` | id, source_id, external_id, category, title, start_utc, end_utc, all_day, location_id, attendance (required/optional/parent_only), status (active/cancelled), deleted_at, rrule (manual only) |
| `event_override` | event_id, new_start_utc, new_end_utc, skip, accept_clash, created_by, created_at, source_changed_since |
| `event_revision` | event_id, changed_at, changed_by (sync/user), before (json), after (json) |
| `location` | id, name, address, travel_buffers (to other locations) |
| `conflict` | id, event_a, event_b, detected_at, resolved_at, resolution |
| `tennis_player` | id, external_id, name, club, rating, rating_rd |
| `tennis_tournament` / `tennis_match` | tournament, draw, round, players, score, winner, scheduled_at, source, manual_correction |
| `swim_meet` / `swim_entry` / `swim_result` | meet, course, event (distance+stroke), seed_time, time_ms, splits, place, is_pb, manual_correction |
| `school_period` | date, period, course, room, teacher |
| `classroom_item` | course, title, due_at, state, grade, max_points, link |
| `video_review` | id, sport, url, provider, note, filmed_on, status, review (json), model, created_at, deleted_at |
| `email_suggestion` | id, gmail_message_id, extracted (json), confidence, status (pending/approved/rejected) |
| `audit_log` | at, actor, action, target (no secret values) |

### 7.2 Retention
- Events, revisions, results, matches, video reviews and link history are kept
  indefinitely. Deletes are soft, with restore available.
- Temp video files: deleted when the job ends.
- Raw emails are not stored. Only the extracted fields and a short quote are kept.
- Sync run logs: 1 year.

### 7.3 Credential encryption
- Each credential is encrypted with its own random data key (AES-256-GCM).
  That data key is encrypted ("wrapped") with a master key that lives only in
  Cloud KMS (a key-encryption key that never leaves KMS), never in the
  database or the repository.
- `key_version` allows the master key to be rotated. A rotation script
  re-wraps all data keys.
- Decryption happens only in the worker, and only at the moment of use. Web
  routes can write credentials but never decrypt them.
- iCal subscription URLs (TeamSnap, Veracross) are secrets as well, because
  anyone with the URL can read the feed. They are stored the same way.

---

## 8. Cost estimate (monthly, rough)

| Item | Estimate |
|---|---|
| Cloud Run: web service (scale to zero) + worker jobs | $0–5 (≈ +$5–10 if web min instances = 1) |
| Cloud SQL for PostgreSQL, smallest shared-core size, 10 GB SSD, backups | $10–30 |
| Cloud Storage (backup exports), Artifact Registry, KMS, Secret Manager, Scheduler | < $3 |
| Firebase Hosting (custom domain + TLS) | $0 (free tier) |
| Domain (already owned) | — |
| Claude: video reviews (about 60 frames each, ~$0.30–0.60 per review, ~10/month) | $3–6 |
| Claude: email extraction (~100 short emails/month) | < $3 |
| Claude: prediction summaries | < $1 |
| **Total** | **about $15–45** |

Google Cloud prices are indicative and must be checked in the GCP pricing
calculator for the Toronto region during S1. Cloud SQL is the largest fixed
cost. Costs could be lowered, for example with a cheaper model for email
extraction. That is the owner's decision and is not assumed here.

---

## 9. Testing and acceptance
- Unit tests: clash detection (overlaps, buffers, closures, overrides), sync
  upsert rules, rating and forecast maths, credential encryption and redaction.
- Adapter tests: run each source adapter against recorded HTML/JSON fixtures.
  A live smoke test per source runs on demand.
- End-to-end (Playwright): sign-in gate, drag and drop resolves a clash on
  desktop and mobile widths, on-demand sync, credential write-only behaviour.
- Go-live checklist: backup restore tested, allow-list checked, `noindex`
  checked, no secret values in logs, owner's Google account 2-step verification on.

---

## 10. Flagged concerns

| # | Concern | Impact | Proposed handling | Owner decision needed? |
|---|---|---|---|---|
| F-1 | **Scraping terms of the tournament and swim sites.** Neither the Tennis Canada tournament site nor Commit Swimming offers a public API. Their terms may forbid automated access even with his own login. | The site could block the account, or pages could change and break a sync. | Scrape only pages the owner can see, once a day plus on-demand, rate-limited (SYNC-5). Manual entry as a fallback (SYNC-6). The owner reviews each site's terms before S2/S3. Ask Tennis Canada or Commit for an export or feed if one exists. | **Decided 2026-09-26:** owner accepts the risk. |
| F-2 | **Opponent data for predictions.** Opponents' results are only as complete as the tournament site. Players new to the circuit will have little history. | Predictions will often be "low confidence" early on. | Show confidence clearly (TEN-6) and backtest (§6.1). | No |
| F-3 | **YouTube videos can't be fetched for analysis.** The YouTube API doesn't provide video files, and YouTube's terms forbid downloading outside YouTube's own features, even for the owner's own private videos. | YouTube links can be saved in history but not reviewed by the site. | Support Google Drive and Google Photos (picker) for reviews. For a YouTube video, keep the original in Photos or Drive and link that. YouTube links can still be saved with manual notes. | **Decided 2026-09-26:** owner accepts. Photos/Drive for reviews. |
| F-4 | **Google Photos links need the Photos picker.** Since March 2025 the Google Photos API can't read an existing library from a pasted share link. Apps must use the Photos Picker, where the owner selects the video. | "Paste a Google Photos link" becomes "Pick from Google Photos" (one extra tap). | Build the Picker flow into VID-1. Drive links work as pasted. | No, unless you object |
| F-5 | **Classroom on a school-managed student account.** The school's Google Workspace admin may block third-party apps from Jayden's account. | SCH-3/SCH-4 may be impossible through the API. | Test during S4. Fallback 1: Classroom guardian email summaries (if the school enables them), parsed from Gmail through EML. Fallback 2: manual. The intent's open question 2 is still open. | **Yes, if blocked:** choose a fallback |
| F-6 | **Google app verification for Gmail/Classroom access.** Reading Gmail is a "restricted" Google scope. For a personal app, Google allows an unverified app for fewer than 100 users, with a warning screen. | One-time "unverified app" warning when connecting. Refresh tokens expire every 7 days if the app is left in "Testing" mode. | Publish the Google app in "Production" as an unverified personal app, and use it only with the family's accounts. | No |
| F-7 | **Spordle and Veracross feed availability not confirmed.** | They may need scraping instead of iCal. | Check during S1/S4. The adapter design supports either. | No |
| F-8 | **"Real time" is limited by the sources.** Edits made on this site are instant, but source data only arrives on the daily or on-demand sync. | A coach's change in TeamSnap appears at the next sync, not instantly. | On-demand refresh (SYNC-2). Email suggestions catch last-minute changes. | No |
| F-9 | **A child's data at a guessable domain.** | A misconfiguration could expose data. | AUTH-1..3, the NFR-2 checklist, and no public pages. A security review before go-live. | No |
| F-10 | **Cold starts.** Cloud Run scaled to zero takes about 1–3 s to wake on the first visit after a quiet period, which can miss NFR-4 (under 2 s). | The first load of the day may feel slow. | Start with scale to zero. If it's annoying, set the web service's min instances to 1 (about $5–10/month). | **Decided 2026-09-26:** start with scale to zero. |
| F-11 | **Toronto region availability.** Every service used (Cloud Run jobs, Cloud SQL, KMS, Scheduler) needs to be confirmed in `northamerica-northeast2` during S1. | Some components may need Montréal (`northamerica-northeast1`) instead. | Still in Canada, and nothing else changes. | **Decided 2026-09-26:** data must stay in Canada (Toronto, or Montréal as fallback). |

---

## 11. Assumptions (carried from intent)
- Resolving a clash changes only this site. Nobody is notified.
- Only the owner logs in. There are no roles or extra users.
- Events are copied one way to a dedicated Google Calendar, which can be switched off.
- Linked videos are sent to Claude for review, and nothing is kept afterwards.
- Home time zone is a setting, confirmed at setup.

## 12. Open questions (not blocking; each has a default)
1. Which Google account holds the household calendar, and which inbox gets
   club emails? *Default: the owner's account, lleiguo@gmail.com, for both.*
2. Classroom fallback if the school blocks access (F-5). *Default: guardian
   email summaries, then manual.*
3. Which activities use TeamSnap and which use Spordle? *Default: set on the
   sources page during S1.*
4. Where do math, Chinese and fitness schedules come from? *Default: repeating
   events in the household calendar.*
