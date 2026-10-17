# Spec: The saved calendar first, on any connection
Status: approved (owner, 2026-10-16, in chat: "approve, defaults"). Written by Claude from [intent.md](intent.md).

Read with [0004 spec](../0004-ios-app/spec.md) (ICAL, OFF, SEC, EXT).
IDs here: SAV (the saved calendar).

## 1. What changes in earlier specs
- **0004 OFF-1** For the calendar, the saved copy is shown first, not only
  offline, and it is kept under one name, not per date range (SAV-1..4).
  Other screens stay as they are.
- **0004 §4.1 State** "renders from the cache first, then the network"
  becomes true for the calendar.
- **0004 OFF-2, OFF-3, SEC-3, EXT-2** stay as they are.

## 2. Requirements

### 2.1 The saved calendar (SAV)
| ID | Requirement | Acceptance criteria |
|---|---|---|
| SAV-1 | Shown first. | With a saved calendar on the phone, opening the Calendar tab (cold launch or switching tabs) draws it before any network answer, in every view (agenda, day, week, month), with filters and "skipped" hiding applied as usual. |
| SAV-2 | Refreshed behind it. | The app requests the calendar at the same time; a good answer replaces what's shown and the saved copy, and clears the banner. No spinner while a saved copy is on screen; pull to refresh shows its usual spinner. |
| SAV-3 | Fast fallback. | No answer within 8 s, or a failed request: the saved copy stays, the banner says "Offline, updated <age>" (OFF-1's banner, age of the saved copy). The request isn't cancelled; if it answers later, SAV-2 applies. With nothing saved, the screen says "Couldn't load the calendar. Pull to try again." as today. |
| SAV-4 | One copy, any week. | The saved copy is kept under one fixed name with the range it covers and when it was fetched. It is used whatever range is asked for: days inside its range show their events, days outside show empty, both under the banner until a fresh answer. A new week or a far date never makes the saved copy disappear. |
| SAV-5 | Only good answers are saved. | An error, a 401 or a partial answer never replaces the saved copy. |

### 2.2 Security (SAVSEC)
| ID | Requirement | Acceptance criteria |
|---|---|---|
| SAVSEC-1 | Same protection as OFF-3. | The file is in the existing `ResponseCache` folder (app group, `completeUntilFirstUserAuthentication`, excluded from backups) and goes with `wipe()` on sign-out or a revoked token (SEC-3). |

## 3. Design
- **HubKit `SavedCalendar`** (new, next to `ResponseCache`): `save(payload
  data, from, to)` and `load() -> (data, from, to, fetchedAt)?`, stored in
  `ResponseCache` under the fixed key `calendar-saved` (JSON body plus a
  small header with the range). Decoding uses the generated
  `listEvents` body type, so it is the server's own shape.
- **`CalendarStore`:**
  - `init`, or the first `ensureLoaded()`, loads `SavedCalendar` into
    `index` if `index` is nil (SAV-1).
  - `load(from:to:)` keeps running the request as today. Before awaiting
    it, a child task waits 8 s; if the request hasn't finished and a saved
    copy is shown, it reports `.offline(since: fetchedAt)` to `AppModel`
    (banner, SAV-3). On success: replace `index`, save, report `.online`
    (SAV-2, SAV-5). On failure: keep `index`, report offline.
  - `ensureLoaded()`'s "already loaded" check counts only fresh answers,
    so a saved copy never stops the refresh.
- **`CacheMiddleware`** keeps its per-path copy for the other screens, but
  neither stores nor replays `listEvents` (`savedByTheApp`): a replayed
  copy would look like a fresh answer and be saved with today's date
  (SAV-5). Offline, the calendar's request fails and the store keeps the
  saved copy and reports its age through `AppModel.showingSaved(since:)`.
  The same happens on a slow or failed reload over this visit's answer.
- No change to the server, the widgets (they keep `WidgetSnapshot`) or
  Shortcuts.

## 4. Testing
- **HubKit unit (`CacheTests`):** save/load round trip with range and
  date; a later week's request still finds the copy (SAV-4); `wipe()`
  removes it (SAVSEC-1); an error answer doesn't overwrite it (SAV-5).
- **App UI (`OfflineTests`):** after one online visit, against a local
  port that accepts and never answers, the agenda shows within 3 s and the
  banner by ~15 s (SAV-1..3). The existing offline test still shows the
  calendar from the saved copy. A new week (SAV-4) is covered by the unit
  test, since the UI test can't move the clock.
- **On the phone (owner):** Airplane mode, open the app: calendar shows at
  once with the banner.

## 5. Concerns for the owner
| # | Concern | Recommendation |
|---|---|---|
| S-1 | For a second or two the saved calendar may show an event that has since moved or been cancelled on the website. | Accept: the fresh answer replaces it within seconds on a normal connection, and the banner says when it's old. |
| S-2 | Days beyond the saved range look empty offline, which could read as "nothing on". | Accept with the banner; the saved range already covers ten weeks ahead. |
