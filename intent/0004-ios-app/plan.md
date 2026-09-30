# Plan: a native iPhone app for the hub
Source: [spec.md](spec.md). Status: approved (2026-09-28).

Same working agreement as [0001's plan](../0001-jayden-hub/plan.md) §1:
one PR per milestone or smaller, each listing its task IDs; nothing merges
with red CI; this file is updated in the same commit when the build
departs from it. Backend tasks keep the existing checks (`pnpm lint`,
`typecheck`, `test`, `test:int`, `test:e2e`); app tasks add
`xcodebuild test` for HubKit and the UI tests they touch.

Order: backend first (the app can't sign in without N1), then the app
skeleton, then features in the order the owner uses them on the go. The
owner uses each TestFlight build for a few days before the next milestone.

---

## 1. Owner prerequisites

| # | Step | Needed by |
|---|---|---|
| O-1 | Join the Apple Developer Program (US$99/year), under the owner's Apple ID. | N2 |
| O-2 | In App Store Connect: create the app record (bundle ID `com.jaydenguo.hub`, not released), add the other parent as an internal tester. | N2.6 |
| O-3 | Create an APNs key (`.p8`) and store it in Secret Manager with `read -rs` (never in chat or the repo); note the key ID and team ID for Terraform. | N7 |
| O-4 | Xcode (current release) on the Mac, signed in to the developer account. | N2 |
| O-5 | Answer the intent's open questions: uploads from the iPhone library, TestFlight vs unlisted, default notifications. | N7, N9 |

---

## 2. Spikes (first; each time-boxed to half a day)

| # | Question | How | Unblocks |
|---|---|---|---|
| SP-N1 | Does Firebase Hosting forward `Authorization` to Cloud Run? | After N1.2 deploys, call `/api/v1/me` in production with a bearer header from `curl`. If the header is stripped, use the `__session` fallback (spec N-3) before the app depends on it. | N1.2 |
| SP-N2 | Can `ASWebAuthenticationSession` complete the site's Google sign-in and return to `jaydenguohub://`? | Throwaway app target against the local dev server with a dev OAuth client. | N2.3 |
| SP-N3 | APNs from Cloud Run: JWT signing and HTTP/2 with Node's built-in `http2`, sandbox environment. | Script in the worker image sending to a TestFlight/dev device token. | N7.2 |
| SP-N4 | Google Photos picker on iOS: does `pickerUri` open in the Google Photos app and return, and how does the app learn the pick is done? | Call the existing picker-session route from a test build; poll the session. | N6.3 |

Results go in a `## Spikes` section of this file.

---

## 3. Milestones and tasks

### N0: API audit and contract (≈ 2 days)
| Task | Description | Spec | Done when |
|---|---|---|---|
| N0.1 | `pnpm openapi`: build `openapi.json` from the route zod schemas (every `/api/v1` route, request and response). CI step fails when the checked-in file is stale. | API-4 | CI green with the file; a deliberate schema change without regenerating fails CI. |
| N0.2 | Audit every page under `src/app/(app)/` for direct database reads and server-only actions; list each gap in this file. | API-3 | Gap list merged here. |
| N0.3 | Add routes for the gaps: `GET /api/v1/today` (school day, next up, waiting-on-owner items), tennis and swim overviews, people and general settings, video submit and Photos picker session. Web pages may switch to them where it's simpler. | API-3 | Integration test per route; route-list e2e covers them (401 signed out). |

**N0 as built (2026-09-29):**
- *Audit (N0.2).* Pages that read the database directly, and what the API
  lacked: Today at school (no route); the Tennis page's "Upcoming
  tournaments" rows, "Found for him" entries and the next matches'
  predictions and explanations (the tournaments route had none of them);
  explanations on the tournament and player routes. Everything else a page
  shows already had a route (swim overview = meets + PBs; People, General,
  Sessions, Costs, video settings and the Photos picker session, which
  `POST /api/v1/videos` already starts, returning `pickerUri`).
- *Routes (N0.3).* `GET /api/v1/today` (`src/server/today.ts`),
  `GET /api/v1/school/today`, and `GET /api/v1/tennis/tournaments` now
  returns the whole Tennis page (`src/server/tennis/overview.ts`); the
  tournament and player routes add `explanations`/`explanation`. All
  additive. One change that isn't: `GET /api/v1/events?deleted=1` answered
  with a different shape from the same path, which a generated client
  can't express, so deleted events moved to `GET /api/v1/events/deleted`
  (the web's Deleted tab moved with it; no other client existed).
- *Contract (N0.1).* The zod schemas only cover requests, so responses
  come from named TypeScript types in `src/server/openapi/responses.ts`,
  read by `scripts/openapi.ts` with the TypeScript checker (an off-the-shelf
  generator couldn't read Drizzle-inferred types). The route registry is
  `src/server/openapi/registry.ts`; a unit test fails if it and the route
  files differ. CI runs `pnpm openapi --check`. Every `/api/v1` JSON
  response the e2e suite sees is validated against `openapi.json`
  (`tests/e2e/support/test.ts`), plus `api-contract.spec.ts` calls every
  GET route. Review-round JSON (`output`, `combinedReview`) stays untyped
  in the schema, with its shapes listed as `ReviewOutput`,
  `CritiqueOutput`, `RebuttalOutput`, `FinalScoreOutput` and
  `CombinedOutput` for the app to decode by `round`.

### N1: Device auth and app-facing backend (≈ 3 days)
| Task | Description | Spec | Done when |
|---|---|---|---|
| N1.1 | Migration: `sessions.kind`, `sessions.device_name`; `auth_codes` table. (Next free migration number at the time; 0021 as of 2026-09-28.) | API-1, API-2 | Migration merged. |
| N1.2 | `client=ios` + PKCE on `/auth/google/start` and callback; `POST /api/v1/auth/device`; bearer tokens in `src/proxy.ts` and route handlers (API paths only); sliding 30-day expiry for devices; device rows in the Sessions list. | API-1, API-2, N-6 | Unit tests (PKCE, code reuse, expiry); e2e: allow-listed sign-in gets a token, others 401; bearer mutation without Origin succeeds; bearer on a page path is ignored; "Sign out everywhere" ends device tokens. SP-N1 checked in production. |
| N1.3 | `POST /api/v1/auth/handoff` and `/auth/handoff` (single-use, 60 s, 1-hour web session), Google connect flows accept a `jaydenguohub://done` return. | API-5 | e2e: handoff opens the connect flow signed in; a reused link fails. |
| N1.4 | `X-App-Version` check with a 426 answer below a configured minimum. | API-6 | Unit test. |
| N1.5 | Dev-only device token route for UI tests, covered by the existing production-build check. | §4.4 | CI check fails if it's reachable in a production build. |

**N1 as built (2026-09-29):**
- Migration 0021 (`device_auth`): `sessions.kind` (`browser`, `device`,
  `handoff`) and `sessions.device_name`; `auth_codes` (HMAC-keyed,
  single use, a minute).
- Sign-in: `/auth/google/start?client=ios&challenge=…&device=…` keeps the
  app's S256 challenge in the pre-login state; the callback redirects to
  `jaydenguohub://auth?code=…` (or `?error=…`) instead of setting a cookie.
  `POST /api/v1/auth/device` (public, rate-limited per address, exempt
  from the Origin check because it takes no cookie) swaps code + verifier
  for a device token. `POST /api/v1/auth/signout` ends the current session.
- Bearer tokens: the proxy and `api()` (`currentApiSession`) take
  `Authorization: Bearer` on API paths only; a request that sends the
  header is judged by it alone (a bad one is 401 even with a good cookie)
  and skips the Origin check. Device tokens expire 30 days after last use
  (renewed with `last_seen_at`, at most once a minute). The Settings
  devices list names app sessions.
- Handoff: `POST /api/v1/auth/handoff` takes only
  `/accounts/google/connect…` as `next`; `/auth/handoff` sets an hour-long
  `handoff` session; `/auth/app-done` (public) ends it and returns to
  `jaydenguohub://done`, and a failed Google connect in a handoff reports
  there too.
- `MIN_APP_VERSION` (unset in production until the first app release): a
  lower `X-App-Version` gets 426. `/auth/dev?client=ios` (development
  builds only) returns a device token for UI tests.
- SP-N1 (does Firebase Hosting pass `Authorization` through?) is checked
  after this deploys; the `__session` fallback would need no app change
  beyond sending the token as that cookie.

### N2: App skeleton (≈ 4 days)
| Task | Description | Spec | Done when |
|---|---|---|---|
| N2.1 | `ios/` with XcodeGen `project.yml`: app, HubKit package, three extension targets (empty), test targets, app group and Keychain group. `ios/README.md`. | §4.3 | `xcodegen && xcodebuild build` works from a clean clone. |
| N2.2 | HubKit API client generated from `openapi.json` (swift-openapi-generator), bearer middleware, `X-App-Version`, 401 → sign-out, 426 → update screen. | API-4, API-6, SEC-3 | HubKit tests decode recorded responses for every route. |
| N2.3 | Sign-in screen (no name or photo of Jayden, AUTH-3), `ASWebAuthenticationSession` + PKCE, Keychain storage, sign-out wipe. | API-1, SEC-1, SEC-3 | UI test signs in against the local server; sign-out leaves no token or cache files. |
| N2.4 | Tab bar and More menu, deep-link router, home time zone formatting, settings → App (sign out, version). | APP-1, §4.1 | UI test visits every tab. |
| N2.5 | Face ID lock and app-switcher blur. | SEC-2 | Manual check on device; unit test for the 5-minute rule. |
| N2.6 | CI: `macos` job builds the app and runs HubKit tests on changes under `ios/` or `openapi.json`. First TestFlight build from Xcode. | §4.4, INFR-4 | CI green; the owner installs from TestFlight and signs in. |

**N2 as built (2026-09-29):**
- Tooling: Xcode 27 with the iOS 27 Simulator; XcodeGen generates
  `JaydenHub.xcodeproj`, which isn't committed (`ios/project.yml`). The
  app is called "Hub" on the home screen (AUTH-3).
- HubKit: `HubAPI` is generated from `openapi.json` (a symlink) by Apple's
  generator plugin; `HubKit` has the config, Keychain token store, PKCE,
  sign-in request, `HubClient` (bearer and `X-App-Version` middleware;
  401 → sign out and wipe, 426 → update screen), home-time formatting,
  deep-link routes and the lock rule. 28 recorded responses decode
  through the generated client.
- Departure: `openapi.json` needed changes for the Swift generator, which
  drops properties that are `anyOf [object, null]` and can't express lists
  with nullable items. The generator now writes nullable scalars as
  `type: [X, "null"]`, and nullable objects as optional properties marked
  `x-nullable` (the e2e contract check reads that). A list with nullable
  items fails `pnpm openapi`. The tennis `predictions` arrays became
  `drawPredictions: { drawId, prediction, explanation }[]` (tournament
  route and overview rows), which nothing on the web read.
- Fixtures come from `scripts/record-api-fixtures.ts`, run against a
  database holding only `pnpm seed`'s data. It replaces the signed-in
  email and the primary person's name and fails if anything personal is
  left.
- App: sign-in (ephemeral `ASWebAuthenticationSession`), tab bar, Today
  (a first version: today's events, school, the week's clashes, what's
  waiting), Settings → App (account, Face ID lock, version, sign out),
  lock with an app-switcher cover, update screen. UI tests: every tab,
  Today with seed data, sign out leaves nothing behind.
- Departure: the three extension targets come with their features (N5
  widgets, N7 notifications, N8 share) rather than as empty targets now,
  and so does the shared Keychain access group.
- CI: `.github/workflows/ios.yml` runs HubKit's tests and a Simulator
  build on changes to `ios/` or `openapi.json`. The first TestFlight build
  waits on O-1/O-2 (the Apple Developer account).
- Signing: the team comes from a git-ignored `ios/Local.xcconfig` (via
  `Signing.xcconfig`), not `project.yml`. While O-1 is under review the
  owner runs builds on their iPhone with a free Personal Team under
  `com.jaydenguo.hub.dev` (7-day builds, no push), so the real bundle ID
  stays free for the paid team.

### N3: Today and Calendar (≈ 7 days)
| Task | Description | Spec | Done when |
|---|---|---|---|
| N3.1 | Today screen with all cards and links. | APP-2 | UI test with seed data shows each card. |
| N3.2 | Agenda, day, week and month views; people and category filters (saved per device); closure banners; clash styling and badge. | ICAL-1..3, APP-1 | UI test: filters persist; a seeded clash is outlined; 375-pt snapshot readable. |
| N3.3 | Event sheet: detail, attendance, override state, "Use the source's time", restore. | ICAL-7 | UI test for each action. |
| N3.4 | Move: long-press drag (15-minute haptic steps) and "Move to…"; swipe Skip, Accept clash, Move; 10 s undo. | ICAL-4, ICAL-5, APP-5 | UI test: moving a clashing event clears the clash; undo restores it. |
| N3.5 | Manual events and series editor. | ICAL-6 | UI test creates a weekly series and deletes one occurrence. |
| N3.6 | Live updates every 10 s while open; pull to refresh; Refresh all with progress. | APP-4, APP-7 | UI test: a change made through the API appears within 10 s. |

**N3 as built (2026-09-29):**
- HubKit `Calendar/`: filters (people, categories, sources; closures
  always shown), clash marks including "clash with a hidden event", school
  blocks (SCH-1), events per home date (all-day by their UTC dates), side-
  by-side placement of overlapping events, and 15-minute move maths.
  `HubClient.perform(undo)` runs the server's undo, only for `/api/v1/…`
  on the site.
- Every API error now reaches the app as `HubError` with the server's own
  words (the middleware throws; `HubError.from` unwraps the generated
  client's wrapper).
- `openapi.json`: `z.coerce.date()` request fields (event and move times)
  are documented as `date-time` strings, so the client sends real dates.
- App: one calendar store shared by Today and Calendar (filters saved per
  device). Agenda (default) with swipe Skip/Move and Accept clash/Optional,
  day and week time grids with long-press drag (15-minute haptic steps,
  across days in the week view), month dots, closure shading, the event
  sheet with every non-drag action and "Move to…", the editor for one-off
  and weekly repeating events, filters, Refresh all sources with progress,
  the 10-second undo banner, the open-clash badge on Calendar, and live
  updates every 10 s while the app is open.
- Today: people chips, closure banner, next up with a countdown, today's
  events, clashes in the next 7 days, school, next match (win %), next
  meet, and what's waiting (entries open the site's entry link; the rest
  go to More until N6).
- UI tests (6 new, 9 in all, against the seed server): drag then undo in the day view
  (reached by deep link), skip then undo from the sheet, add then delete an
  event (a failed run cleans up in `tearDown`), people chips remembered
  across launches, the agenda's clash mark, Today's cards.

### N4: Tennis and Swimming (≈ 5 days)
| Task | Description | Spec | Done when |
|---|---|---|---|
| N4.1 | Tennis tab: next match card, upcoming table, found-for-him (Safari entry link), tournament, player, results, accuracy; score and time corrections. | ITEN-1 | UI test per screen with seed data; a correction shows at once. |
| N4.2 | Swimming tab: meets, meet results, PB table, progression chart with forecast band and accessible table; result corrections. | ISWM-1, APP-6 | UI test; VoiceOver reads the chart table. |

**N4 as built (2026-09-29):**
- Seed: `pnpm seed` now makes a tennis season too (made-up players with
  numeric member numbers, five past tournaments, an upcoming one with his
  draw and a next opponent he has played, and one found for him), so the
  tennis screens have data locally and in the fixtures. Fixtures add
  `getTournament` and `getTennisPlayer`.
- HubKit `Sports/`: the API's unions made plain (next match in a draw,
  upcoming status, forecast), set scores from either side, swim times and
  changes formatted as on the web. `HubClient.patch` sends explicit nulls:
  the generated client leaves nil fields out, which the correction routes
  read as "unchanged", so clearing a DQ, place or start time, or marking a
  match not played, goes through it. (The event and series edits don't
  need it: those routes default missing fields to null.)
- `Route` gains `/tennis/results` and `/tennis/accuracy`; Tennis and
  Swimming have their own navigation paths, so links open inside them.
- Tennis: next matches with the estimate and why, in progress, upcoming
  (status, next opponent, win %, the site's enter or pay link), found for
  him (opens the entry page in Safari), past; tournament, player (head-to-
  head, form, estimate), results (season filter, running W–L) and accuracy
  pages. Tapping a match opens its sheet: links to the tournament and
  opponent, the score/result/time correction, "use the site's result" and
  delete with undo. A list row holds one link, so "How accurate is this?"
  is a row under each estimate.
- Swimming: upcoming and past meets (sessions, entries with seed times,
  swims and PBs), PBs per course, meet pages, and the event page with a
  Swift Charts progression chart (swims, PB steps, the estimate line and
  likely range labelled "Estimate", faster higher) followed by a "Chart
  values" table VoiceOver reads row by row. Tapping a swim opens its sheet
  with splits, the time/DQ/place correction, "use Commit's time" and
  delete with undo.
- Rows take a tap anywhere (not only on their text), and the correction
  sheets put "Save correction" above the keyboard, which covers the form's
  own button while typing.
- Refresh on both tabs syncs that sport's source and follows it until done
  (APP-7); refusals show the server's reason.
- Departure: adding a match or a swim by hand stays on the website for
  now (ITEN-1 and ISWM-1 ask for corrections only); it can join N8.
- UI tests (5 new): the tennis page with the next match and a found
  tournament; tournament, player and accuracy pages by tap and deep link;
  a score correction that shows at once and goes back to the site's; the
  PB table and the chart's value table; a swim-time correction and back.
  Corrections are undone through the API in `tearDown`.

### N5: Offline cache and widgets (≈ 4 days)
| Task | Description | Spec | Done when |
|---|---|---|---|
| N5.1 | HubKit response cache in the app group (file protection, no backup), cache-first stores, "Offline, updated …" banner, offline write refusal. | OFF-1..3 | HubKit tests; UI test in airplane mode (network link conditioner) shows cached Today and refuses a move. |
| N5.2 | Widgets: small, medium, lock screen rectangular and inline; privacy-sensitive; reload on fetch and background refresh. | EXT-1, EXT-2 | Widget previews with seed data; manual check on device, locked and unlocked. |

**N5 as built (2026-09-29):**
- App group `group.com.jaydenguo.hub` (plus the `.dev` suffix on a Personal
  Team, like the bundle ID), set in `Signing.xcconfig`. A free Personal
  Team can sign it, so the widgets run on the owner's iPhone before O-1.
- HubKit `Cache/`: `ResponseCache` keeps the last answer to every GET in
  the app group (readable after first unlock, out of backups, oldest pruned
  past 300). A client middleware stores answers and, when there's no
  connection, replays them and reports how old they are; the change feed is
  never replayed. Writes offline fail with "You're offline" and nothing is
  queued (OFF-2). Sign-out and a refused token wipe it (SEC-3).
- The calendar is cached as loaded: the week before to ten weeks ahead of
  the day shown, not exactly "30 days back to 90 ahead" (OFF-1); other
  screens are cached as they're opened.
- App: "Offline, updated 2 hours ago" banner over every tab while cached
  answers are shown.
- Widgets (`HubWidgets` extension): "Next up" (small, lock screen
  rectangular and inline) and "Today" (medium), privacy-sensitive. They
  read a snapshot the app writes whenever the calendar loads or the people
  filters change (the calendar's filters, school days folded into
  "School", clashes marked) and never call the API. Timelines redraw at
  each event's end and at midnight in the home zone. Background app
  refresh (about hourly, as iOS allows) fetches the next days and redraws
  them; a notification arriving joins this in N7.
- Tests: HubKit (12 new: cache, offline, wipe, pruning, backups, snapshot
  timeline and building from the seed calendar); a UI test that opens the
  app on a closed port after one online visit, sees the cached Today and
  calendar with the banner, and has a skip refused.

### N6: School, Videos, Suggestions, Settings (≈ 7 days)
| Task | Description | Spec | Done when |
|---|---|---|---|
| N6.1 | School screen and Today card links. | ISCH-1 | UI test. |
| N6.2 | Videos: history, review detail (advice, both reviews, verdict, vote, scoreboard), compare, delete, restore, retry. | IVID-1 | UI test. |
| N6.3 | Start a review: Drive link, Photos picker (per SP-N4), sport, date, note, segment. | IVID-3 | UI test with the fake Google APIs from the web e2e support. |
| N6.4 | Player: download with bearer to a protected temp file, AVKit, markers, jump buttons, following point, speeds, frame step, landscape, delete video; temp file removed on close. | IVID-2 | UI test: a jump button seeks and shows the point; no clip file left after closing. |
| N6.5 | Suggestions: approve (with edits) and reject, swipe actions. | IEML-1 | UI test. |
| N6.6 | Settings: Sources (refresh, progress, history, per-source settings), Accounts (secure fields, test, remove, codes, Google connect via handoff), People, General, Clashes, Costs (Swift Charts + table), Deleted, Sessions. | APP-3, SEC-5, API-5 | UI test per screen; a saved password never appears in any response or on screen. |

**N6 part 1 as built (2026-09-29): School, Suggestions, Settings** (Videos,
N6.2–N6.4, follow in part 2):
- Seed: the sample school calendar is now a sample Veracross portal with
  four classes a day (rooms, teachers, links), because "Today at school"
  reads only enabled Veracross sources; the calendar still folds a day's
  classes into one "School" block. Two coach-email suggestions (a new
  practice, a moved game) reset to pending, and events approved from them
  removed, on every `pnpm seed`.
- School: today's or the next school day's periods (tap one for Veracross),
  key dates and closures from the calendar, and the portal link. Today's
  school card links here.
- Suggestions: each with its quote and "check the …" for low-confidence
  fields; tap to edit and approve, or swipe to approve or reject. The
  More tab counts pending ones; Today's "waiting" row opens the list.
- Settings: General (home time zone, copy to Google Calendar), People,
  Sources (state, refresh with live progress, run history, on/off, name,
  default category), Accounts (per provider; add, update, test with the
  sign-in code step, remove; secrets in secure fields and never shown;
  Google connected through the handoff in the browser sheet), Clashes,
  Costs (Swift Charts with the same numbers as rows), Deleted (restore),
  Sessions (this phone first; "Sign out everywhere" signs this phone out
  too), and App.
- `HubClient.post` joins `patch` for bodies with explicit nulls (approving
  with no start time, adding an account).
- More has its own navigation path, so links to School, Suggestions,
  Sources, Accounts and Settings open inside it.
- Departure: adding a source and editing its category rules or
  kind-specific settings stay on the website.
- Fixed while testing: swiping a row away with a "destructive" button, or
  swapping the last row for an empty-state view, could crash the list when
  the reload arrived; empty states are overlays and swipe buttons are
  tinted instead.
- Tests: HubKit (5 new); UI tests (4 new): the school day and a key date;
  approve an edited suggestion and reject another; a saved password is
  never on screen or in any API response; every settings screen opens.

**N6 part 2 as built (2026-09-30): Videos**
- Seed: two made-up tennis reviews built by the real debate code with the
  fake models (a finished debate with the 6-second test pattern as its
  playback copy when `MEDIA_DIR` is set, and an older Gemini-only review
  to compare with); fixed ids, so each seed resets them and the vote.
- HubKit `Video/`: the reviews, critiques, replies and scores the API sends
  as schemaless JSON, decoded into Swift types; the timeline (cited times,
  the point on screen, m:ss) as on the web. `HubClient.download` fetches
  the playback copy with the device token into a temporary file protected
  until the phone is unlocked.
- History per sport with deleted reviews to restore, swipe to delete or
  restore, compare two, the scoreboard and the review mode.
- The review page: progress while it runs (every 3 s), the Google Photos
  pick button, retry; the player (AVKit, muted) with point markers, the
  current point following playback, jump buttons in the advice,
  0.25×/0.5×/1×, frame steps, landscape on this screen only, and "Delete
  video"; the combined advice with agreed and disputed points, the
  verdict, the one-time vote, both models' reviews, scores, critiques and
  replies. The temporary file is deleted when the screen closes.
- Starting a review: a Drive (or YouTube, saved only) link or a Google
  Photos pick, sport, date filmed, note and an optional part.
- SP-N4 (Photos picker on the phone) needs the owner: the app opens the
  picker link, which iOS hands to the Google Photos app or Safari; the
  worker notices the pick as on the web.
- Tests: HubKit (6 new); UI tests (4 new): history and the review page, a
  jump button that seeks to 0:02 and shows "Fix 1", the vote, and saving a
  link then deleting and restoring it. "No clip file left after closing"
  was checked by hand in the Simulator: leaving the review deletes its
  file, and files left by an app killed mid-review are deleted at the next
  launch (found in that check).
- Today: a school day's classes are one "School" row (they're listed in
  the school card), found when the seed gained real periods.

### N7: Notifications (≈ 4 days)
| Task | Description | Spec | Done when |
|---|---|---|---|
| N7.1 | Migration: `devices`, `notifications`. Routes: register device, notification kinds, `GET /api/v1/notifications/{id}`. | PUSH-3, PUSH-2 | Integration tests. |
| N7.2 | `src/server/push/` APNs client (per SP-N3) with a fake for tests; log-only without the key; drop invalid tokens. Terraform: secret, key ID and team ID env on web and worker. | PUSH-6 | Integration test against a fake APNs; `terraform validate`; owner applies. |
| N7.3 | `notify()` calls with dedup keys from clash detection, tennis draw watch, entries and acceptance, the video worker, the sync runner (3 failures, once a day) and email extraction. | PUSH-1, PUSH-5 | Integration test per kind; a repeated sync doesn't notify twice. |
| N7.4 | App: permission prompt (after sign-in, explained first), device registration, notification settings screen, Notification Service Extension fetching the text, deep links on tap. | PUSH-2..4 | Manual check on device for each kind; the generic text shows with the network off. |

**N7 as built (2026-09-30), against a fake APNs** (real pushes need the
paid team and the key, O-1 and O-3):
- Tables (migration 0023): `devices` (one per device session, deleted with
  it; token, sandbox or production, the bundle ID as the APNs topic, the
  kinds) and `notifications` (kind, dedup key, title, body, target; pruned
  after 90 days by the daily sync).
- Routes: `GET`/`POST`/`PATCH /api/v1/devices/current` (settings, register
  the token after each launch, choose kinds; device sessions only) and
  `GET /api/v1/notifications/{id}`.
- `src/server/push/`: `apns.ts` signs an ES256 JWT with the `.p8` key
  (refreshed every 50 minutes) and posts over HTTP/2 with `node:http2`;
  410 or `BadDeviceToken` drops the device. Without `APNS_KEY` it only
  logs. `notify()` stores the notification once per dedup key and sends
  each phone that wants the kind `{aps: {alert: "Hub" / "New update",
  mutable-content}, id, kind}`, nothing else.
- Kinds (`kinds.ts`) and where they fire:
  - clash: after every source's sync, for clashes in the next 14 days the
    owner hasn't accepted (key: the event pair);
  - draw: after a tennis sync, each new next opponent (key: draw, round,
    opponent), so the first is "the draw is out";
  - entry_action: after the Thursday entry job, entries found or waiting
    for payment (key: entry and status);
  - entry_change: reserve to main draw, or off the list, from the
    acceptance and draw-watch jobs;
  - video: when a review finishes or fails (key: review and finish time,
    so a review run again notifies again);
  - sync_failed: at the third failure in a row, once a day per source;
  - suggestion: one per mailbox read with new suggestions (off by
    default).
- Departures from the spec: the generic text is "Hub" / "New update", not
  "Jayden Hub" (AUTH-3: nothing about him on the lock screen); only the
  worker sends (every kind is noticed by a job), so the key goes to the
  worker alone.
- Terraform: the `apns-key` secret (worker only), `apns_key_id` and
  `apns_team_id`. The worker gets the key only once `apns_key_id` is set,
  so an apply before the secret has a version doesn't break the job.
  Steps in `infra/README.md`.
- App: "Turn on notifications?" explained once after sign-in, then iOS's
  prompt; the token registered after each launch; Settings → App →
  Notifications (also `jaydenguohub://open/settings/notifications`) with a
  switch per kind; taps open the target, or fetch it first when the
  extension couldn't. `HubNotify`, a Notification Service Extension,
  fetches the text with the device token, which now lives in the app group
  (moved there once at launch) so the extension can read it.
- Signing: `aps-environment` is in the app's entitlements. A free Personal
  Team can't sign push for a phone, so `Local.xcconfig` picks
  `HubApp-NoPush.entitlements` for phone builds; the app says "this build
  can't get notifications" there.
- Checked in the Simulator: the prompt, a real sandbox token registered
  with the server, the settings screen, and a tap on a pushed id opening
  the video review. `simctl push` skips service extensions, so the text
  rewrite waits for the first real push (TestFlight).
- Tests: integration (push, 6: registration and kinds, the payload and
  JWT, dedup, who gets it, dead tokens, clashes, entry changes, once a day;
  video review notifies); HubKit (4 new).

### N8: Share extension, Shortcuts and polish (≈ 4 days)
| Task | Description | Spec | Done when |
|---|---|---|---|
| N8.1 | Share extension for URLs; Google Photos links hand over to the app's picker. | EXT-3 | Manual check from Safari, Drive and Google Photos. |
| N8.2 | App Intents: what's next, today's schedule, refresh all. | EXT-4 | Runs from Shortcuts and Siri on device. |
| N8.3 | Accessibility pass (Dynamic Type sizes, VoiceOver, contrast), performance check (INFR-2), app icon and launch screen with no personal details. | APP-6, INFR-2, AUTH-3 | Accessibility Inspector audit clean on every screen; launch timing noted here. |
| N8.4 | Security review of the app and new backend routes, added to [0001's security-review.md](../0001-jayden-hub/security-review.md) or a new file here. | SEC-1..5, API-1..6 | Review merged; fixes done or risks accepted by the owner. |
| N8.5 | Runbook in `ios/README.md`: release steps, the 60-day TestFlight reminder, rotating the APNs key, what to do if a phone is lost (Sign out everywhere). | N-5 | Owner has read it. |
| N8.6 | Live Activity for tournament and meet days, only if the owner asks for it after N7. | EXT-5 | Manual check on a real event day. |

### N9: Upload from the iPhone library (only if the owner says yes to open question 1)
Needs its own spec section first (spec N-7): trimming on the phone,
resumable upload to the media bucket, the worker reading from the bucket
instead of Google, and the privacy change to 0001/0003.

---

## 4. Risks during the build

| Risk | Mitigation |
|---|---|
| The API changes under the app while both are built. | Contract checked in CI (N0.1); additive-only rule (API-6). |
| UI tests need the local backend, Postgres and seed data on the Mac. | Reuse the web e2e set-up (PG16 on 5433, seed, fake Google/OIDC). |
| Swift 6 strict concurrency slows early work. | Stores on the main actor; HubKit's networking `Sendable`; no custom threading. |
| Two UIs drift apart. | The parity table (spec §3) is the checklist for every new feature; each PR says "web, iOS or both". |

---

## 5. Estimate

About 40 working days for N0–N8 (N8.6 and N9 excluded), with a
TestFlight build at the end of each milestone from N2 on. The first
useful build (sign-in, Today, Calendar with moves) lands after N3,
about 16 days in.

## 6. Status
| Milestone | Status |
|---|---|
| N0 | done 2026-09-29 (#45, deployed) |
| N1 | done 2026-09-29 (#46, deployed); SP-N1 passed: Firebase Hosting forwards `Authorization` |
| N2 | done 2026-09-29 (#47); first TestFlight build waits on O-1/O-2 |
| N3 | done 2026-09-29 (#49) |
| N4 | done 2026-09-29 (#50) |
| N5 | done 2026-09-29 (#52) |
| N6 | done 2026-09-30 (#53, #55); SP-N4 waits for the owner. Intent 0005 (sport detected, and changed on the review screen) added to the Videos screens on `video/sport-detect` |
| N7 | built 2026-09-30 on `ios/n7-notifications` against a fake APNs; the owner adds the APNs key (O-3) and checks each kind on the phone once TestFlight works |
| N8 | not started |
| N9 | not planned (owner kept the no-upload default) |

## Spikes

| # | Result |
|---|---|
| SP-N1 | **Passed 2026-09-29.** In production, a POST with `Authorization: Bearer <unknown token>` and no Origin gets 401 (the proxy saw the header and skipped the Origin check), while the same POST without it gets 403. So Firebase Hosting forwards `Authorization` to Cloud Run, and the `__session` fallback isn't needed. |
| SP-N2 | Covered by N2: the sign-in sheet is `ASWebAuthenticationSession` with the `jaydenguohub` custom scheme (the e2e test walks the same redirects). The first real Google sign-in in the app is checked on a device once TestFlight works. |
| SP-N3 | Partly: the APNs client (ES256 JWT, `node:http2`) works against a fake APNs over HTTP/2 in the integration tests, and a Simulator build gets a real sandbox token. Sending through Apple waits for the key (O-3). |
| SP-N4 | Not run yet (N6.3). |
