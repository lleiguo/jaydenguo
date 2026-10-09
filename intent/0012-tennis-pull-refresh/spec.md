# Spec: Pull down to refresh his tennis entries
Status: approved (owner, 2026-10-09, in chat: "approve, defaults"; question 3: "keep the refresh button for full sync on both mobile and web"). Written by Claude from [intent.md](intent.md).

Read with 0001 (SYNC-2, SYNC-5, TEN-9..11) and 0004 (APP-7, ITEN-1).
IDs here: TPR (tennis pull refresh).

## 1. What changes in earlier specs
- **0004 APP-7** Pulling down on the iPhone Tennis screen runs the quick
  check (TPR-1). Its Refresh button stays and runs the full sync (TPR-5).
- **0001 SYNC-2** Unchanged: Refresh on the web Tennis page and on the
  Sources page runs the full sync.
- **0001 SYNC-5** The quick check has its own limit (TPR-4); it doesn't
  count as a sync run, so it doesn't hold back the full sync.

## 2. Requirements
| ID | Requirement | Acceptance criteria |
|---|---|---|
| TPR-1 | Pull down on the iPhone Tennis screen checks Tennis Canada. | The pull starts the quick check, keeps the spinner until it finishes (up to 2 minutes), then reloads the screen. Other screens are unchanged. |
| TPR-2 | The quick check reads his entries and entry lists. | One run: his account's "My entries" (as #101), then each upcoming entry's event page (status, reserve place, withdrawn). No tournament search, no profile, no opponents' histories. A typical run (4 entries) makes under 15 requests. |
| TPR-3 | The quick check looks for draws. | For entries starting within 7 days: a draw seen for the first time starts the full sync (as the draw watch). For tournaments under way whose draw is already in: only that draw and his matches are re-read (results, next match, next opponent's level). |
| TPR-4 | The site is asked at most once every 5 minutes. | A pull within 5 minutes of the last quick check's start only reloads, and the screen says "Checked N min ago". A failed check can be retried at once. While one runs, a second pull waits for it instead of starting another. |
| TPR-5 | The Refresh buttons keep the full sync. | The Refresh button stays on the iPhone and web Tennis screens and starts the full sync as now (SYNC-2, SYNC-5). Owner, 2026-10-09: "keep the refresh button for full sync on both mobile and web". |
| TPR-6 | Problems are said plainly. | A login problem shows "Tennis Canada sign-in failed: check the login on the Accounts page." on the screen; a site error shows "Couldn't reach Tennis Canada. Try again later." What's shown isn't cleared. |

## 3. Design
- **Job.** A worker job `tennis:check <sourceId>` (Cloud Run, as other
  jobs; only the worker opens the login). It reuses `fromAccount` and
  `checkLists` from `src/server/tennis/entries.ts`, then a draw step:
  `runDrawWatch`'s first-sighting logic, plus a new draw-only read for
  tournaments under way (the bracket or match list of his draw and the
  next opponent's profile, through the adapter's existing parsers).
- **Tracking.** A new table `tennis_checks` (source, started, finished,
  status, counts, error). The 5-minute limit, "Checked N min ago" and the
  app's follow-along read it. `sync_runs` and the hourly limit don't see
  it.
- **API.** `POST /api/v1/tennis/check` → 202 with the check: a new one,
  or the last (`recent: true`) while it runs or is under 5 minutes old
  (one status, for the generated iPhone client);
  `GET /api/v1/tennis/check/{id}` → status. `GET /api/v1/tennis` adds `lastCheckedAt`. OpenAPI updated.
- **iPhone.** `TennisScreen`'s `refreshable` calls the check and follows
  it, then reloads; `RefreshSourcesButton` stays in the toolbar.
- **Web.** No change.

## 4. Testing
- Unit: the 5-minute rule; which entries get a draw read.
- Integration (fake site): a check updates an entry from "My entries"
  and a list, makes no search requests, starts the full sync on a first
  draw, re-reads only the draw once synced, and the limit holds.
- API: start, follow, too-soon, already running.
- iOS: HubKit tests for the follow-along; simulator screenshot of the
  pull spinner and "Checked N min ago".

## 5. Concerns for the owner
| # | Concern | Recommendation |
|---|---|---|
| P-1 | The first sight of a draw still runs the full sync (about 4 min). | Accept: it happens once per tournament; the screen says "Draw is out, getting opponents…". |
| P-2 | A Cloud Run job takes 10–20 s to start. | Accept for now; a check is still well under a minute. |
