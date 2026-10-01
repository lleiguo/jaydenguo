# Spec: a native iPhone app for the hub
Source: [intent.md](intent.md). Status: approved (owner, 2026-09-28, in chat,
with the defaults: N-1 and N-6 accepted, N-5 TestFlight, N-7 no uploads).

The app is a second client of the existing backend. It does everything
the website does (parity table in §3), plus notifications, widgets,
sharing and offline reading. The website keeps every feature.

Changes to 0001: §1 "Native mobile apps" and "Push notifications" move
from out of scope to in scope for iPhone. NFR-8 ("one language") gains
Swift for the app only (concern N-1). AUTH-4's 30-day session becomes
"30 days since last use" for the app (concern N-6).

---

## 1. Principles

- **Thin client.** The server stays the only place that decides clashes,
  predictions, forecasts, dedup, sync and AI. The app shows what the API
  returns and sends the owner's actions back. No domain logic is ported
  to Swift, so there is one source of truth and one set of tests for it.
- **Parity through the API.** Every screen is built on `/api/v1` routes.
  Where a web page reads the database directly today, the backend gets a
  route first (API-3), and the web page may keep its direct read.
- **Mobile first, not web on a phone.** Native navigation, sheets, swipe
  actions, haptics, Dynamic Type, dark mode. No web views for app screens
  (sign-in and Google connect use the system's secure browser sheet).
- **Nothing sensitive leaves Google Cloud.** Notifications through Apple
  carry an ID only (PUSH-2). No third-party SDKs.

---

## 2. Requirements

### 2.1 Backend for the app (API)
| ID | Requirement | Acceptance criteria |
|---|---|---|
| API-1 | Device sign-in. | The app opens `/auth/google/start?client=ios&challenge=…` in `ASWebAuthenticationSession`. The server runs the same Google OpenID Connect flow and allow-list (AUTH-1), then redirects to `jaydenguohub://auth?code=…` with a one-time code (60 s, single use, bound to the PKCE challenge). The app exchanges code + verifier at `POST /api/v1/auth/device` for a device token. A wrong verifier, a reused or expired code, or an account not on the allow-list gets 401 and creates nothing. |
| API-2 | Bearer tokens on the API. | `/api/v1/*` accepts `Authorization: Bearer <device token>`. Device tokens are rows in `sessions` (kind `device`, HMAC-keyed like cookies, device name stored), shown in the Sessions list and ended by "Sign out everywhere" (AUTH-4). A request with a bearer token ignores cookies and skips the Origin check (browsers never send it on their own, so CSRF doesn't apply). Pages (non-API paths) never accept bearer tokens. The route-list e2e test proves 401 without a token for every route, as today. |
| API-3 | API parity. | Every piece of data a web page shows and every action it offers has a documented `/api/v1` route. An audit (N0.2) lists the gaps; each gets a route with an integration test. Known gaps: Today at school, the Tennis and Swimming overviews, People and General settings, starting a video review from Drive or the Photos picker. |
| API-4 | OpenAPI document. | `pnpm openapi` writes `openapi.json` from the routes' zod schemas (planned in 0001 §2, not built yet). CI fails if the checked-in file is stale. The app's client is generated from it, so a breaking API change fails the app build, not the owner's phone. |
| API-5 | Web handoff for browser-only flows. | Google connect flows (Calendar, Gmail, Drive, Photos, Classroom) need a browser session. `POST /api/v1/auth/handoff` returns a single-use link (60 s) that, opened in `ASWebAuthenticationSession`, sets a short web session (1 hour) and continues to the flow, which ends at `jaydenguohub://done`. |
| API-6 | Versioning. | Changes to `/api/v1` stay additive. A removal or rename needs `/api/v2` or a release of the app first. The app sends `X-App-Version`; the server can answer 426 with a "please update" message for builds too old to work. |

### 2.2 Sign-in and security on the phone (SEC)
| ID | Requirement | Acceptance criteria |
|---|---|---|
| SEC-1 | The device token lives only in the Keychain. | `AfterFirstUnlockThisDeviceOnly`, in a Keychain group shared with the app's extensions. Not in files, defaults, logs or backups. |
| SEC-2 | App lock. | Face ID (or the passcode) on launch and after 5 minutes in the background. On by default, can be turned off in the app's settings. The app switcher shows a blurred screen. |
| SEC-3 | Sign out wipes the phone. | Signing out, a 401 from a revoked token, or turning off the account removes the token, the offline cache, the widget data and the push registration. |
| SEC-4 | No third-party SDKs. | Only Apple frameworks and Apple's own OpenAPI generator packages. No analytics or crash reporting beyond Apple's opt-in diagnostics. |
| SEC-5 | Credentials stay write-only. | The Accounts screen can set, test and remove source logins (CRED-1..7) with secure text fields. Nothing is read back or kept on the phone. |

### 2.3 Screens and navigation (APP)
| ID | Requirement | Acceptance criteria |
|---|---|---|
| APP-1 | Tab bar: Today, Calendar, Tennis, Swimming, More. | More holds Videos, School, Suggestions and Settings (Sources, Accounts, People, Clashes, Costs, Deleted, Sessions, General, App). The open-clash count shows on Calendar and on More → Settings → Clashes, as on the web. |
| APP-2 | Today screen. | One scroll: school closure banner, what's next (with a countdown), today's events for the selected people, clashes in the next 7 days, Today at school, the next tennis match (opponent, time, win %), the next swim meet, and anything waiting on the owner (entries to pay, suggestions to review, failing sources). Each card opens its detail. |
| APP-3 | Parity. | Every web screen in §3 has an app screen with the same data and actions. |
| APP-4 | Live updates. | While the app is open, it asks `/api/v1/changes` every 10 s and updates the screen (CAL-8). Pull to refresh on every list. |
| APP-5 | Phone ergonomics. | Primary actions in thumb reach; edits in sheets; swipe actions on list rows; haptics on success and undo; 10 s undo banner wherever the web has undo (CON-3/4). |
| APP-6 | Accessibility. | Dynamic Type up to the accessibility sizes without clipped text, VoiceOver labels on every control and chart, colour plus icon per category (CAL-1), and a non-drag way to do everything drag does (NFR-9). |
| APP-7 | Refresh sources. | "Refresh" on the calendar, sport screens and Sources starts syncs as on the web (SYNC-2), with live progress and the same refusal reasons (SYNC-5). Each due source syncs in its own run, side by side; the app follows each until it has a new finished run (up to 10 minutes) and names scraped sources left alone because they synced within the hour. Pulling down on the calendar reloads and also refreshes the sources (owner, 2026-09-30). |

### 2.4 Calendar (CAL on iOS)
| ID | Requirement | Acceptance criteria |
|---|---|---|
| ICAL-1 | Agenda (default), day, week and month views. | Native views, not FullCalendar. Week view is readable at 375 pt. Month shows category dots per day; tapping a day opens its agenda. The agenda starts now: what's already over is hidden until "Show earlier". Day and week open at the event on now or next (owner, 2026-09-30). |
| ICAL-2 | People and category filters. | People chips (Jayden, Lei, Ethan, …) and category filters as on the web, saved per device. |
| ICAL-3 | Clashes. | Red outline and warning icon in every view (CON-2); event detail shows the other event and the overlap in minutes. |
| ICAL-4 | Move. | Long-press and drag in day and week views (with haptic ticks at 15-minute steps), and "Move to…" (date and time pickers) everywhere. Calls the existing move route; the clash highlight updates from the server's answer. Undo for 10 s. |
| ICAL-5 | Swipe actions. | On agenda rows: Skip, Accept clash, Move. Leading swipe: Jayden's attendance. Skip on a repeating event asks "this one" or "every repeat" (CON-4). |
| ICAL-6 | Manual events and series. | Create, edit, delete and restore, with the same repeat rules as the web (CAL-5). |
| ICAL-7 | Event detail. | Source, last sync, source link, owner (person), attendance, override and "source changed since you moved this" (CON-5) with "Use the source's time". |
| ICAL-8 | Add to Apple Calendar is not offered. | The Google Calendar copy (GCO) already reaches phones; the app doesn't write to the iPhone's calendar. |

### 2.5 Sport, school, video and suggestion screens
| ID | Requirement | Acceptance criteria |
|---|---|---|
| ITEN-1 | Tennis. | Upcoming tournaments (status, opponent and time, win %), found-for-him list with the entry link (opens in Safari to pay), tournament detail with draw position, player pages (form, head-to-head, level), results with a season filter and running W–L, accuracy page, and score or time corrections (TEN-8) with "use the source's value". |
| ISWM-1 | Swimming. | Upcoming meets with session day and time and entries, meet results, PB table, per-event progression chart (Swift Charts; SCM and LCM never on one line) with the forecast band labelled "Estimate", and result corrections (SWM-7). Every chart has an accessible table (NFR-9). |
| ISCH-1 | School. | Today at school (periods, rooms, teachers), key dates and closures, and links to Veracross. Homework and grades follow the web when M4.3 is built. |
| IVID-1 | Video reviews. | History per sport, review status with progress, the combined advice with agreed and disputed points, both models' reviews, the parent vote and scoreboard, compare, delete and restore, and retry. |
| IVID-2 | Video player. | The playback copy (0003) is downloaded with the device token to a protected temporary file, played with AVKit, and deleted when the screen closes. Markers under the video, jump buttons, the current point following playback (PLAY-4/5), 0.25×/0.5×/1× and frame step (PLAY-3). "Delete video" as on the web (PLAY-7). |
| IVID-3 | Start a review. | Paste or share a Google Drive link, or pick from Google Photos (the Photos picker opens in the Google Photos app or the secure browser sheet, as spike SP-N4 finds). Sport, date filmed, note and segment as on the web. |
| IEML-1 | Suggestions. | Each suggestion with its quote and low-confidence marks; approve (optionally after editing fields) or reject with a swipe. |

### 2.6 Notifications (PUSH)
| ID | Requirement | Acceptance criteria |
|---|---|---|
| PUSH-1 | Kinds. | New clash in the next 14 days; draw out and next opponent (TEN-11); entry needs finishing or paying (TEN-9); moved from reserve to main draw, or off the entry list (TEN-10); video review done or failed; a source failed 3 times in a row (SYNC-4; the email stays); new email suggestion. |
| PUSH-2 | Nothing personal through Apple. | The APNs payload holds a generic alert ("Jayden Hub: new update"), a kind and a notification ID. A Notification Service Extension fetches `/api/v1/notifications/{id}` with the device token and rewrites the text before it shows. If the fetch fails, the generic text shows. |
| PUSH-3 | Settings. | Each kind on or off per device (defaults: open question 3; until answered, all on except "new suggestion"). The app follows iOS notification settings and Focus. |
| PUSH-4 | Tapping opens the right screen. | Each notification deep-links to its clash, tournament, video or source. |
| PUSH-5 | No duplicates, no storms. | One notification per event per device (a clash that comes and goes within a sync doesn't notify twice), at most one sync-failure notification per source per day. |
| PUSH-6 | Sending. | Token-based APNs (a `.p8` key in Secret Manager), HTTP/2 from Node's built-in client, from the worker and web service. Invalid device tokens are dropped when APNs says so. Without the key (local, CI), notifications are logged instead. |

### 2.7 Widgets, sharing and Shortcuts (EXT)
| ID | Requirement | Acceptance criteria |
|---|---|---|
| EXT-1 | Widgets. | Home screen small ("Next up") and medium ("Today"), lock screen rectangular and inline ("Next: Swim 17:30"). Filtered by the app's selected people. Clashes marked. Content is marked privacy-sensitive, so iOS can hide it on a locked phone. |
| EXT-2 | Widget freshness. | Widgets read the offline cache. They refresh when the app fetches data, on background app refresh, and when a notification arrives; the timeline rolls forward at each event's end. |
| EXT-3 | Share extension. | Sharing a URL from any app offers "Review in Jayden Hub": sport, note and date, then it submits the link (VID-1). A Google Photos share link, which the API can't read (F-4), opens the app at the Photos picker instead with the note kept. |
| EXT-4 | Shortcuts and Siri. | App Intents for "What's next for Jayden", "Today's schedule" and "Refresh all sources". |
| EXT-5 | Live Activity (optional). | On a tournament or meet day, the next match or swim with its time on the lock screen and Dynamic Island, ended when the day's last event ends. Built only if the owner wants it after N7. |

### 2.8 Offline (OFF)
| ID | Requirement | Acceptance criteria |
|---|---|---|
| OFF-1 | Read offline. | The last responses for Today, the calendar (30 days back to 90 days ahead), tennis and swim overviews, and the last opened details are cached and shown with "Offline, updated 2 h ago". |
| OFF-2 | Writes need a connection. | Actions offline show "You're offline" and do nothing; no hidden queue that could apply stale changes later. |
| OFF-3 | The cache is protected. | Files in the app group with `completeUntilFirstUserAuthentication` protection (widgets must read them while locked), excluded from backups, wiped on sign-out (SEC-3). Video copies are never cached (IVID-2). |

### 2.9 Non-functional (INFR)
| ID | Area | Requirement |
|---|---|---|
| INFR-1 | Platform | iPhone, iOS 18+, portrait first (landscape for the video player). SwiftUI, Swift 6 strict concurrency. |
| INFR-2 | Performance | Cold launch to cached Today in under 1 s on a recent iPhone; fresh data in under 3 s on 4G with a warm backend. |
| INFR-3 | Size and battery | No background polling; background app refresh at most every few hours, as iOS allows. |
| INFR-4 | Distribution | TestFlight internal testing (owner's and the other parent's Apple IDs as App Store Connect users). Not listed on the App Store (AUTH-3). |
| INFR-5 | Cost | Apple Developer Program, US$99 a year. APNs is free. No other new running cost. |

---

## 3. Parity table

Every web screen and what changes for the phone.

| Web (today) | App | Tailoring |
|---|---|---|
| Calendar (`/`) with Refresh, + Add event | Calendar tab; Today tab | Agenda default, swipe actions, long-press move, month dots; Today screen is new |
| Event detail, attendance, override, restore | Event sheet | Attendance as a swipe; "Move to…" pickers |
| Series editor | Series sheet | Native repeat picker |
| Tennis overview, tournament, player, results, accuracy | Tennis tab | Next match card first; entry links open Safari |
| Swimming overview, meet, event progression | Swimming tab | Swift Charts; PB table newest first |
| Today at school card, key dates | Today card; More → School | — |
| Videos list, review, compare, scoreboard, settings | More → Videos | Share extension; downloaded playback; landscape player |
| Settings → Sources (refresh, history, per-source settings) | More → Settings → Sources | Live progress rows |
| Settings → Accounts (logins, Google connect, codes) | More → Settings → Accounts | Secure fields; connect through handoff (API-5); code entry with one-time-code autofill |
| Settings → People, General | Settings → People, General | — |
| Settings → Clashes | Settings → Clashes (+ badge) | Swipe to skip or accept |
| Settings → Suggestions | More → Suggestions | Swipe approve or reject |
| Settings → Costs | Settings → Costs | Swift Charts with the same table (COST-1) |
| Settings → Deleted | Settings → Deleted | Swipe to restore |
| Sessions, sign out everywhere | Settings → Sessions | Shows "iPhone app — device name" |
| — | Settings → App | Face ID lock, notification kinds, widget people, sign out |

---

## 4. Design

### 4.1 App architecture
```
 iPhone
 ┌───────────────────────────────────────────────────────────────┐
 │ HubApp (SwiftUI)          HubWidgets    HubNotify    HubShare │
 │   feature screens         (WidgetKit)   (service     (share   │
 │        │                       │         extension)  ext.)    │
 │        └──────────┬────────────┴────────────┴──────────┘      │
 │               HubKit (Swift package)                          │
 │   generated API client · auth + Keychain · cache (app group)  │
 │   · formatting (home time zone) · deep links                  │
 └───────────────────────────┬───────────────────────────────────┘
                             │ HTTPS, Authorization: Bearer
                             ▼
      jaydenguo.com → Firebase Hosting → Cloud Run web (/api/v1)
                             │
      worker jobs ── notifications table ── APNs (ID-only payload)
```

- **HubKit** holds everything that isn't a view, so the app and all three
  extensions share it and it is unit-tested without a simulator.
- **State:** `@Observable` stores per feature, loading through HubKit;
  each store renders from the cache first, then the network.
- **Time:** all times arrive in UTC; HubKit formats them in the home time
  zone from `/api/v1/settings` (CAL-9), not the phone's zone, so a trip
  doesn't shift Jayden's schedule. The zone name is shown when they
  differ.

### 4.2 Backend changes
- `sessions.kind` (`browser` | `device`), `sessions.device_name`,
  sliding expiry for devices (N-6).
- `auth_codes` for the one-time sign-in and handoff codes (hashed,
  60 s, single use).
- `devices`: session ID, APNs token, environment (sandbox or production),
  notification kinds, last seen.
- `notifications`: kind, target, created at, the text (built on the
  server), and a dedup key. Kept 90 days.
- `src/server/push/`: APNs client (JWT from the `.p8` key, HTTP/2),
  `notify(kind, target, dedupKey)` called from clash detection, the
  tennis jobs, the video worker, the sync runner and email extraction.
- `src/lib/routes.ts` and `src/proxy.ts`: bearer tokens on API paths
  (API-2); `/auth/google/*` learns `client=ios`.
- `openapi.json` generation (API-4) and the parity routes (API-3).

### 4.3 Repository layout
```
ios/
├── project.yml            # XcodeGen spec; the .xcodeproj is generated, not committed
├── HubKit/                # Swift package: API client (generated from ../openapi.json), auth, cache
├── HubApp/                # app target: Features/<Today|Calendar|Tennis|Swimming|Videos|School|Settings>
├── HubWidgets/  HubNotify/  HubShare/
├── HubAppTests/  HubAppUITests/
└── README.md              # set-up, signing, TestFlight release steps
openapi.json               # generated by `pnpm openapi`, checked in
```

### 4.4 Tests
- HubKit: Swift Testing; decoding against recorded API responses, auth
  flow, cache wipe, time formatting across DST.
- UI: XCUITest against the local dev server with seed data and a dev-only
  token route (disabled in production like `/auth/dev`; the existing CI
  check covers it): sign-in, Today, move an event and undo, swipe skip,
  approve a suggestion, play a review and jump to a point.
- Backend: integration tests for every new route; the route-list e2e
  extends to bearer tokens; push tests with a fake APNs.
- CI: GitHub Actions `macos` runner builds the app and runs HubKit tests
  on every change under `ios/` or to `openapi.json`. UI tests run locally
  before each TestFlight build (CI later, if worth the runner time).

---

## 5. Concerns

| # | Concern | Handling | Owner decision? |
|---|---|---|---|
| N-1 | A second language and UI. Every future feature needs building twice, and NFR-8's "one language" no longer holds. | Thin client (§1) keeps logic on the server. New intents say "web, iOS or both". Swift only in `ios/`. | Yes: accept |
| N-2 | Notifications go through Apple. | ID-only payloads, text fetched by the service extension (PUSH-2). Apple sees that a notification was sent, not what it says. | No |
| N-3 | Firebase Hosting may not forward the `Authorization` header to Cloud Run (it strips all cookies but `__session`, F-14). | Spike SP-N1 first. Fallback: send the device token in the `__session` cookie from the app, which Firebase does forward; the proxy tells them apart by `sessions.kind`. | No |
| N-4 | A child's data cached on a phone. | File protection, no backups, Face ID lock, wipe on sign-out or revocation (SEC-2/3, OFF-3). | No |
| N-5 | TestFlight builds expire after 90 days, and each tester needs an App Store Connect role. | Release at least every 60 days (a reminder in the runbook). An unlisted App Store app is the alternative (intent question 2). | Yes |
| N-6 | AUTH-4 says sessions last 30 days; signing in on the phone every month is friction. | Device sessions expire 30 days after last use, not after sign-in; Face ID guards the app; "Sign out everywhere" still ends them within a minute. | Yes: accept |
| N-7 | Clips filmed on the iPhone live in Apple Photos, which the server can't read. | Default: keep Drive and Google Photos only. If the owner allows uploads (intent question 1), the app would upload the trimmed clip to the media bucket (0003) and the worker would review it from there; that needs its own spec section before N9. | Yes |
| N-8 | The API isn't fully documented and some pages skip it. | N0.2 audit and API-3/API-4 before any app screen depends on them. | No |
| N-9 | The owner's Mac is the build machine (Xcode, signing). | Signing with automatic provisioning in Xcode; archive and upload from Xcode (no App Store Connect key in GitHub). Xcode Cloud can take over later. | No |
