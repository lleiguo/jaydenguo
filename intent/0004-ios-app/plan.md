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

### N3: Today and Calendar (≈ 7 days)
| Task | Description | Spec | Done when |
|---|---|---|---|
| N3.1 | Today screen with all cards and links. | APP-2 | UI test with seed data shows each card. |
| N3.2 | Agenda, day, week and month views; people and category filters (saved per device); closure banners; clash styling and badge. | ICAL-1..3, APP-1 | UI test: filters persist; a seeded clash is outlined; 375-pt snapshot readable. |
| N3.3 | Event sheet: detail, attendance, override state, "Use the source's time", restore. | ICAL-7 | UI test for each action. |
| N3.4 | Move: long-press drag (15-minute haptic steps) and "Move to…"; swipe Skip, Accept clash, Move; 10 s undo. | ICAL-4, ICAL-5, APP-5 | UI test: moving a clashing event clears the clash; undo restores it. |
| N3.5 | Manual events and series editor. | ICAL-6 | UI test creates a weekly series and deletes one occurrence. |
| N3.6 | Live updates every 10 s while open; pull to refresh; Refresh all with progress. | APP-4, APP-7 | UI test: a change made through the API appears within 10 s. |

### N4: Tennis and Swimming (≈ 5 days)
| Task | Description | Spec | Done when |
|---|---|---|---|
| N4.1 | Tennis tab: next match card, upcoming table, found-for-him (Safari entry link), tournament, player, results, accuracy; score and time corrections. | ITEN-1 | UI test per screen with seed data; a correction shows at once. |
| N4.2 | Swimming tab: meets, meet results, PB table, progression chart with forecast band and accessible table; result corrections. | ISWM-1, APP-6 | UI test; VoiceOver reads the chart table. |

### N5: Offline cache and widgets (≈ 4 days)
| Task | Description | Spec | Done when |
|---|---|---|---|
| N5.1 | HubKit response cache in the app group (file protection, no backup), cache-first stores, "Offline, updated …" banner, offline write refusal. | OFF-1..3 | HubKit tests; UI test in airplane mode (network link conditioner) shows cached Today and refuses a move. |
| N5.2 | Widgets: small, medium, lock screen rectangular and inline; privacy-sensitive; reload on fetch and background refresh. | EXT-1, EXT-2 | Widget previews with seed data; manual check on device, locked and unlocked. |

### N6: School, Videos, Suggestions, Settings (≈ 7 days)
| Task | Description | Spec | Done when |
|---|---|---|---|
| N6.1 | School screen and Today card links. | ISCH-1 | UI test. |
| N6.2 | Videos: history, review detail (advice, both reviews, verdict, vote, scoreboard), compare, delete, restore, retry. | IVID-1 | UI test. |
| N6.3 | Start a review: Drive link, Photos picker (per SP-N4), sport, date, note, segment. | IVID-3 | UI test with the fake Google APIs from the web e2e support. |
| N6.4 | Player: download with bearer to a protected temp file, AVKit, markers, jump buttons, following point, speeds, frame step, landscape, delete video; temp file removed on close. | IVID-2 | UI test: a jump button seeks and shows the point; no clip file left after closing. |
| N6.5 | Suggestions: approve (with edits) and reject, swipe actions. | IEML-1 | UI test. |
| N6.6 | Settings: Sources (refresh, progress, history, per-source settings), Accounts (secure fields, test, remove, codes, Google connect via handoff), People, General, Clashes, Costs (Swift Charts + table), Deleted, Sessions. | APP-3, SEC-5, API-5 | UI test per screen; a saved password never appears in any response or on screen. |

### N7: Notifications (≈ 4 days)
| Task | Description | Spec | Done when |
|---|---|---|---|
| N7.1 | Migration: `devices`, `notifications`. Routes: register device, notification kinds, `GET /api/v1/notifications/{id}`. | PUSH-3, PUSH-2 | Integration tests. |
| N7.2 | `src/server/push/` APNs client (per SP-N3) with a fake for tests; log-only without the key; drop invalid tokens. Terraform: secret, key ID and team ID env on web and worker. | PUSH-6 | Integration test against a fake APNs; `terraform validate`; owner applies. |
| N7.3 | `notify()` calls with dedup keys from clash detection, tennis draw watch, entries and acceptance, the video worker, the sync runner (3 failures, once a day) and email extraction. | PUSH-1, PUSH-5 | Integration test per kind; a repeated sync doesn't notify twice. |
| N7.4 | App: permission prompt (after sign-in, explained first), device registration, notification settings screen, Notification Service Extension fetching the text, deep links on tap. | PUSH-2..4 | Manual check on device for each kind; the generic text shows with the network off. |

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
| N0 | done 2026-09-29 (`ios/n0-api-contract`) |
| N1 | built 2026-09-29 (`ios/n1-device-auth`); SP-N1 after deploy |
| N2–N8 | blocked on O-1 and O-4: Xcode isn't installed on the Mac yet (only the command line tools) |
| N9 | not planned (owner kept the no-upload default) |
