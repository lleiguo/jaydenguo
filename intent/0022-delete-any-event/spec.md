# Spec: Delete any calendar event
Status: approved (owner, 2026-10-18, in chat: "Approve intent 0022 with the defaults."); D-1..D-3 accepted. Written by Claude from [intent.md](intent.md).

Read with 0001 (CAL-6, CON-4), 0004 (ICAL-6), 0011 (TID-3) and 0020
(TWO-4). IDs here: DEL (delete).

## 1. What changes in earlier specs
- **0001 CAL-6** "A manual delete sets `deleted_at`" now covers any event
  (DEL-1). Kept forever, restorable, in the history: as it is.
- **0004 ICAL-6** Delete and restore are no longer only for manual events
  (DEL-2).
- **0020 TWO-4** Household events can also be deleted with the switch Off
  or Dry run, in the hub only (DEL-4). With it On: as it is.
- **0001 CON-4, 0011 TID-3** Skip stays as it is.

## 2. Requirements

### 2.1 Delete (DEL)
| ID | Requirement | Acceptance criteria |
|---|---|---|
| DEL-1 | Any event can be deleted. | `DELETE /api/v1/events/{id}` sets `deleted_at` for a manual, series, feed (school, tennis, swim, Spordle, iCal), email or household event, writes a `delete` revision, and answers 200 with the undo as today. It no longer answers 409 "events from a source can be skipped, not deleted". An event already deleted answers 404. |
| DEL-2 | Delete on every event, after a confirm. | Web event detail and iPhone event sheet show Delete on every event that isn't deleted. Both ask first: "Delete “<title>”?", and for a source event add "It stays deleted when <source> syncs. Restore it from Settings → Deleted." |
| DEL-3 | Sync doesn't bring it back. | A sync that sees the event again, changed or not, updates its source fields but leaves `deleted_at` set; it stays out of every view. A source that drops it marks it `cancelled` as today; it stays deleted. |
| DEL-4 | Household events. | Switch On: as TWO-4 (deleted in Google by the next `household:sync`). Switch Off or Dry run: deleted in the hub only; the confirm says "It stays in the family's Google Calendar." |
| DEL-5 | Restore. | Settings → Deleted (web and iPhone) lists deleted source events with their source; Restore clears `deleted_at` and writes a `restore` revision. A restored event shows the source's latest version. |
| DEL-6 | Deleted means gone everywhere. | A deleted event is not in the calendar views, Today, clashes, the school-day summary, Cookie's calendar tools or the Google copy (0001 GCO), and a hub event written to Household is removed from it (0020 TWO-1). These already filter `deleted_at`; tests prove it for a source event. |
| DEL-7 | Cookie unchanged. | Cookie's delete keeps today's rule (her own adds and manual events). Asked to delete a source event, she says she can skip it, or the owner can delete it in the calendar. |

## 3. Design
- `deleteEvent` (`src/server/calendar/mutations.ts`): drop the "source"
  refusal; for a household source with the switch not On, delete in the
  hub only (no `household_links` change, so `household:sync` doesn't
  touch Google). Cookie's call passes `{ sourceEvents: false }` to keep
  today's rule.
- Sync (`src/server/sync/apply.ts`) already never writes `deleted_at`;
  a test pins it. The email "same lesson" match (0013) skips deleted
  events, so a new email about a deleted lesson comes as a new
  suggestion, as for a manual delete.
- Web: `event-detail.tsx` shows one Delete for every event, with the
  confirm text above; the household "Delete…" button merges into it.
- iPhone: `EventSheet.swift` shows Delete for every event with the same
  confirm; `CalendarStore.delete` unchanged. Settings → Deleted shows the
  source.
- No schema, migration or API shape change (`openapi.json` only loses the
  409 description).

## 4. Testing
- Integration: delete a feed, email and household event (switch Off and
  On); a re-sync with the event unchanged and changed keeps it deleted;
  restore brings back the latest version; Cookie can't delete a feed
  event.
- e2e (web): delete a source event from its detail; it leaves the week
  view and appears in Settings → Deleted; Restore brings it back.
- iOS: HubKit/app build; simulator screenshot of Delete and its confirm
  on a source event.

## 5. Concerns for the owner
| # | Concern | Recommendation |
|---|---|---|
| D-1 | A deleted tennis event doesn't withdraw the entry; the tennis page still shows the entry. | Accept: say so in the confirm for tennis ("This doesn't withdraw the entry"). |
| D-2 | A deleted occurrence of a feed's repeating event doesn't stop the others. | Accept: delete each, or use "Skip every repeat". A "delete every repeat" can be a later intent. |
| D-3 | Restoring a household event that was deleted in Google (switch On) brings it back in the hub only; the next read marks it cancelled. | Accept: add it again in Google if wanted. |
