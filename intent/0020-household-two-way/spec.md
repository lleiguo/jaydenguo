# Spec: One family calendar, both ways
Status: draft (2026-10-17). Written by Claude from [intent.md](intent.md).

Read with [0001 spec](../0001-jayden-hub/spec.md) (SRC-1, SYNC, CAL-5,
CON-3, CON-5, GCO) and [0008 spec](../0008-cookie-calendar-changes/spec.md)
(GCW, EMS-6). IDs here: TWO (what goes to Household), BACK (changes from
Google), DUP2 (no duplicates), TWSEC (security).

## 1. What changes in earlier specs
- **0001 GCO-1** ("one-way copy to Jayden (hub); never writes to
  household") is replaced by TWO: the hub writes every event to
  Household, and the copy calendar is retired (TWO-8). GCO-2 stays for
  the old calendar: off, and the owner chooses to delete it.
- **0001 SRC-1** "read" becomes "read and write", same grant as 0008.
- **0001 SYNC-5** Household is read every 15 minutes in the day (BACK-1),
  not only daily and on demand.
- **0001 CON-3, CON-5** A drag or skip of any event is also written to
  Household (TWO-4). A feed event's override can now also come from a
  Google edit (BACK-3); the badge works as today.
- **0001 CAL-5** A manual event's edits and deletes reach Household
  (TWO-3). Repeating manual events go as single events (TWO-6).
- **0008 GCW-2** ("remove only events Cookie added") widens to every
  event the hub manages (TWSEC-1). GCW-5 stays: what Cookie adds is one
  more hub event written by the same job.
- **0008 EMS-6** Applied email suggestions are written to Household too.
- **Household duplicates** (`src/domain/duplicates.ts`, PR #64): a
  household twin of a feed event is linked (DUP2-2), not only hidden.

## 2. Requirements

### 2.1 What goes to Household (TWO)
| ID | Requirement | Acceptance criteria |
|---|---|---|
| TWO-1 | Every hub event, once. | Each active, not-skipped event from any source except Household itself, for every person, dated 30 days back to 366 days ahead, exists in Household as exactly one Google event tagged with its hub ID (private property `hubEventId`). Re-running the job changes nothing. |
| TWO-2 | Whose it is, readable. | The Google title starts with the owner's name when the hub title doesn't already name them ("Jayden – Tennis lesson"; two people: "Jayden + [brother] – …"; everyone: no prefix), so the household read gives it the same owners (`ownersFor`, 0008 §2.4). Description: the category, the notes, and "From the family hub". Location as in the hub. |
| TWO-3 | Hub changes follow. | Creating, editing or deleting an event in the hub (website, app, Cookie, a feed's sync) changes Household within 2 minutes in normal running. A feed event that disappears from its feed is deleted from Household. |
| TWO-4 | Household events edited in the hub. | Moving (drag, CON-3), editing title/time/place, or deleting (after "Delete?") a household event in the hub patches or deletes that Google event. Skipping one occurrence of a repeating household event cancels only that occurrence in Google. Once Google has the change the local override is cleared, so the event is plain again. |
| TWO-5 | School days. | A day of school classes goes as one "School" event per child, from the first class to the last; closures and school-calendar events go as themselves. |
| TWO-6 | Repeating hub events. | Written as single events, one per occurrence in the window, each with its own hub ID. |
| TWO-7 | Past events are left alone. | Events that ended before now are never created, changed or deleted in Google by the job. |
| TWO-8 | The old copy. | Turning two-way sync on switches the "Jayden (hub)" copy off (GCO-2). The calendar and its events stay in Google until the owner deletes it there. |
| TWO-9 | Off and dry run. | Settings → Sources → Household has "Two-way sync": Off (today's behaviour), Dry run, On. Dry run lists what the next run would create, change and delete, without writing. Off stops writing; events already written stay. |

### 2.2 Changes from Google (BACK)
| ID | Requirement | Acceptance criteria |
|---|---|---|
| BACK-1 | Read often. | Household is read every 15 minutes from 06:00 to 22:00 home time, hourly overnight, and on demand (Sources → Refresh, Cookie's refresh). A change made in Google shows in the hub by the next read. |
| BACK-2 | Hub-written events aren't new events. | A Google event with `hubEventId` is never stored as a household event. Its times, title and place are compared with what the hub last wrote; only a difference counts as a Google edit. |
| BACK-3 | A Google edit to a feed event. | Moving it in Google saves a local override (as a drag would), with "changed in Google Calendar". Deleting it in Google marks it skipped in the hub. The feed's next change still shows with the CON-5 badge, and the job does not undo the Google move. A title or place edit to a feed event is put back at the next run: overrides hold times only (0001 `event_override`). |
| BACK-4 | A Google edit to a hub-made event. | (Added on the site, by Cookie, or an applied email.) The hub event takes the new title, time and place; deleted in Google, it is deleted in the hub. |
| BACK-5 | Both sides changed. | When an event changed in the hub and in Google since the last run, the later change wins (Google's `updated` against the hub's change time); the event shows which side won. Nothing is merged field by field. |
| BACK-6 | Hand-made household events. | Read as today (owners from the title, category rules, DUP rules). |

### 2.3 No duplicates (DUP2)
| ID | Requirement | Acceptance criteria |
|---|---|---|
| DUP2-1 | No loop. | Writing then reading Household, any number of times, leaves one hub event and one Google event per item. A test runs write → read → write three times against a fake Google and finds no new rows. |
| DUP2-2 | Twins are linked. | When a hand-made household event is a twin of a feed event (today's DUP rules: same person, same time, matching title or category), the job doesn't create a second Google event. It tags the hand-made one with the feed event's hub ID and from then on keeps its time and place in step with the feed; its title stays as the family wrote it. |
| DUP2-3 | Lost answers. | If the job dies after Google created an event but before the hub recorded its ID, the next run finds it by `hubEventId` and records it instead of creating another (as 0008's `findAdded`). |
| DUP2-4 | One writer at a time. | The job and the household read take the household source's lock (0008 GCW-5). |

### 2.4 Security (TWSEC)
| ID | Requirement | Acceptance criteria |
|---|---|---|
| TWSEC-1 | Fenced writer. | The writer is bound to the one calendar of the household source. It deletes or patches only events that have a `hubEventId`, or household events the owner changed in the hub (TWO-4). It never touches events outside the window or in the past (TWO-7). |
| TWSEC-2 | A brake. | A run that would delete more than 10 events, or change more than 50, stops without writing and sends the owner a notice with the list; "Apply anyway" on Sources runs it once. The first On run after Dry run is held the same way. |
| TWSEC-3 | Same grant, same place. | `calendar.events.owned` on the existing `calendar_write` credential; decrypted only in the worker (0001 CRED-4). No new scope. |
| TWSEC-4 | Nothing more leaves the hub. | Events go to the family's own Google calendar (as 0008, NFR-1). Notes go as written; no credentials, tokens or links with secrets (a feed's iCal URL is never written). |

## 3. Design
- **Mapping table** `household_links`: hub event ID, Google event ID,
  hash of what was last written, Google `updated` last seen, origin
  (`hub` or `household`), linked twin flag. It replaces
  `calendar_copy_events` for Household (that table stays for the old
  calendar until it's deleted).
- **Job `household:sync`** (worker), started after any hub change (as
  `assistant:actions` is), by the 15-minute schedule, and by the daily
  sync:
  1. Lock the household source; read Household (today's adapter, plus
     `extendedProperties` and `updated`).
  2. BACK: for tagged events, compare with the last-written hash; apply
     Google edits (BACK-3/4/5). Untagged events go through today's
     upsert and DUP rules.
  3. TWO: build the wanted set from the hub (as `planCopy` does, all
     people, TWO-2 titles, TWO-5 school blocks); diff with
     `household_links`; link twins (DUP2-2); check the brake (TWSEC-2);
     create, patch, delete. Household events with a pending hub change
     (TWO-4) are patched and their override cleared.
  4. Record hashes and `updated`; unlock.
- **Writer**: `googleCalendarWriter` gains `patch` and `list` by
  `hubEventId`; the fence (TWSEC-1) is in the writer, not the caller.
- **Cookie**: `assistant:actions` stops writing to Google itself; it
  creates the hub event and starts `household:sync`. Undo deletes the hub
  event and the job removes it from Google.
- **Schedule**: a Cloud Scheduler entry in `infra/scheduler.tf` for
  `household:sync` (Terraform apply by the owner).
- **Settings**: the three-way switch and the dry-run list (TWO-9), the
  last run's counts and any held run (TWSEC-2).

## 4. Testing
- **Unit:** title prefixes both ways (TWO-2 written, `ownersFor` reads it
  back to the same owners); school blocks; the plan diff (create, patch,
  delete, keep); twin linking; BACK-5 winner; the brake.
- **Integration (fake Google):** write → read → write ×3 with no new
  rows (DUP2-1); a lost answer (DUP2-3); a Google move of a tennis event
  becomes an override with the badge after the feed changes (BACK-3); a
  Google delete of a manual event deletes it (BACK-4); a hub drag of a
  household event patches Google and clears the override (TWO-4); the
  fence refuses an untagged event (TWSEC-1); Cookie's add and Undo
  through the job.
- **e2e:** the Settings switch and dry-run list.
- **Production (owner):** Dry run first; then On, check Household in
  Google Calendar has the week's tennis, swim and school once each, move
  one in Google and see it in the hub at the next read.

## 5. Concerns for the owner
| # | Concern | Recommendation |
|---|---|---|
| T-1 | **Household gets busy.** About 10–20 hub events a week per child land in it, seen by everyone who shares Household (and on their phones' notifications if they have them on). | Accept; school is one block a day (TWO-5). If it's too much, a later intent can leave out categories. |
| T-2 | **A bug can change the family's own events.** The hub now patches and deletes in Household. | Accept with the fence (TWSEC-1), the brake (TWSEC-2) and Dry run before On. Google keeps deleted events in its bin for 30 days. |
| T-3 | **Not instant from Google.** An edit in Google Calendar reaches the hub within 15 minutes in the day, an hour at night. | Accept. Google's push notifications need a public webhook and channel renewal; a later intent if 15 minutes is too slow. |
| T-4 | **Google edits to feed events are overrides, not changes at the source.** Moving a tennis match in Google doesn't move it at Tennis Canada. | Accept; same as a drag today (CON-5). |
| T-5 | **Cost.** About 70 short worker runs a day. | Under $1 a month on Cloud Run jobs at today's run time (SP-E2: 11–15 s). |
| T-6 | **Renaming in Google can change the owner.** Removing "Jayden –" from a title in Google changes whose event it is at the next read (BACK-4 takes the title). | Accept; it's how household events already work. |
