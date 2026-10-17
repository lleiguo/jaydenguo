# Spec: "Accepted" once he's in the main draw, and the list behind it
Status: draft (2026-10-16). Written by Claude from [intent.md](intent.md).

Read with 0001 (TEN-2, TEN-10, TEN-11, SYNC-5), 0004 (ITEN-1) and 0012
(TPR-2).
IDs here: ACC (accepted).

## 1. What changes in earlier specs
- **0001 TEN-10** Main draw shows as "Accepted". On Fridays the list is
  read again until it's out (ACC-2); his name in a draw counts (ACC-3);
  the list is kept and shown (ACC-4, ACC-5).
- **0001 TEN-2 / 0004 ITEN-1** An upcoming tournament without a synced
  draw opens the app's entry page instead of the site.
- **0012 TPR-2** The quick check keeps the list too (same code as ACC-4).

## 2. Requirements
| ID | Requirement | Acceptance criteria |
|---|---|---|
| ACC-1 | "Accepted" for the main draw. | An entry in the main draw shows "Accepted" on the web Tennis page, the iPhone Tennis screen and the entry page, and Cookie's tennis answers say "accepted". Reserve shows "Reserve list (N)"; not yet listed shows "Registered". |
| ACC-2 | Friday reads until the list is out. | On Fridays the acceptance job runs every 2 hours from 08:00 to 20:00 (home time). Each run reads only his entries still "entered" or "payment_needed" (or all of them on the 08:00 run). A run with nothing to read makes no requests. |
| ACC-3 | In a draw means accepted. | When the event page shows draws and no list, and his name or tournament player number is in one of that event's draws, the entry becomes `main_draw`. Not found in the draws leaves it as it was (never withdrawn). |
| ACC-4 | The list is kept. | Each read of a shown list replaces that entry's stored list: for each row, name(s), tournament player number(s), status (main draw / reserve / none) and reserve place, in the site's order. A hidden list leaves the stored one. |
| ACC-5 | Tapping shows the list. | Tapping an upcoming tournament (web and iPhone) opens its entry page: tournament, event, dates, venue, his status, "List read <time>", then "Main draw (N)" with every main-draw player, him highlighted and known players linked to their player page, then "Reserve list (N)" collapsed, with places. Before the list is out: "The acceptance list isn't out yet." Once his draw is synced, the tournament page shows the same list section. |
| ACC-6 | A push when accepted. | Moving from entered, payment needed or reserve to main draw sends one push: "Accepted: <tournament> (<event>)". Once per entry. |

## 3. Design
- **Parser.** `entryStatusOf` also takes "Accepted"/"Main draw (…)"
  labels found in SP-A1. `parseEventPage` keeps only the fields in ACC-4
  (no seed, no club).
- **Storage.** New table `tennis_entry_list` (entry_id → `tennis_entries`
  on delete cascade, position, names text[], tournament_player_ids
  text[], status, reserve_position), replaced per entry inside the
  update in `checkLists` and `findListed`. One migration (`pnpm
  db:generate --name tennis_entry_list`).
- **Draw check (ACC-3).** When `entriesShown` is false and `draws` is not
  empty, read each draw's page once (as the draw watch does) and look for
  him; at most one draw read per event.
- **Schedule.** `tennis_acceptance_schedule` default becomes
  `0 8-20/2 * * 5`; `runAcceptance` takes the "settled" filter except on
  the first Friday run (an argument from the job).
- **API.** `GET /api/v1/tennis/entries/{id}` → the entry and its list
  (players matched to known players by tournament player number or
  name). `upcomingRows` gains `entryId`; labels from one function. OpenAPI
  updated.
- **Web.** `/tennis/entries/[id]` page; the Upcoming row links there when
  there's no synced tournament; the tournament page gains the list.
- **iPhone.** `Route.tennisEntry(id)` and an `EntryScreen`; build bump
  and TestFlight after.
- **Push.** `notifyEntryChange` sends ACC-6 (replaces "In the main draw").

## 4. Testing
- Unit: labels; `statusFromList` with new labels; draw check finds him
  by number and by name; Friday run filter.
- Integration (fake site): list stored and replaced; hidden list keeps
  it; hidden list + draw with him → main_draw; push once.
- API and e2e: entry page shows Accepted, the main draw, him highlighted,
  reserves collapsed; "isn't out yet".
- iOS: HubKit decode test; simulator screenshot of the entry screen.
- Production: next Friday, the Tennis page shows "Accepted" for a
  main-draw entry and the list matches the site.

## 5. Concerns for the owner
| # | Concern | Recommendation |
|---|---|---|
| A-1 | The app keeps other children's names from the list. | Accept: same as opponents in draws today; only names and player numbers, no profiles fetched for them. |
| A-2 | The schedule change is in `infra/`. | You run the Terraform apply after merge; until then Friday stays one 10:00 run (pull to refresh still updates). |
