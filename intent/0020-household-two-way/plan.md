# Plan: One family calendar, both ways
Status: approved (owner, 2026-10-17, in chat: "approve intent 0020 with the defaults"), with [spec.md](spec.md).

Order: check Google allows what we need, then the safe half (writing,
behind Dry run), then reading changes back, then the schedule and
retiring the copy. Each milestone is off in production until the owner
switches it on.

## 1. What the owner does
| # | Step | Needed for |
|---|---|---|
| O-1 | Make sure "Let Cookie add events" (Accounts) is granted for the account that owns Household. | H2 |
| O-2 | Turn Two-way sync to **Dry run**, read the list, then **On**; approve the first held run (TWSEC-2). | H2 done |
| O-3 | Terraform apply for the 15-minute schedule. | H4 |
| O-4 | Move one event in Google Calendar and check the hub; move one in the hub and check Google. | Done |
| O-5 | Delete the "Jayden (hub)" calendar in Google when happy (optional). | — |

## 2. Spikes
| # | Question | How | Blocks |
|---|---|---|---|
| SP-T1 | Can `calendar.events.owned` patch and delete an event in Household that **another** account created (the other parent's), and one instance of a repeating series? | OAuth Playground with the owner signed in, as SP-E1; on a test event, then undone. | H3 (TWO-4) |
| SP-T2 | Does a full read of Household return `extendedProperties.private` and `updated` for every event, within the 2 s pacing? | Run the adapter against production in the worker with logging only. | H1 |

## 3. Milestones
| # | What | Spec | PR |
|---|---|---|---|
| H1 | `household_links` migration; pure planner (wanted set, TWO-2 titles, TWO-5 school blocks, twin linking, brake); writer gains `patch`/list and the fence. Unit tests. No job yet. | TWO-1,2,5,6,7, DUP2-2, TWSEC-1,2 | #154 |
| H2 | Job `household:sync`, write half: creates/patches/deletes hub events in Household; Off/Dry run/On switch and dry-run list in Settings; hub changes start the job; the household read skips events the hub wrote (from BACK-2); switching On turns the copy off (TWO-8, from H4). Cookie keeps her own write. Integration tests with fake Google. | TWO-1..9, DUP2-1,3,4, TWSEC-1..4 | |
| H3 | Read half: tagged events compared and applied (BACK-2..5); household events changed in the hub patched in Google and override cleared (TWO-4). | BACK-1..6, TWO-4 | |
| H4 | `infra/scheduler.tf` entry, every 15 min in the day, hourly at night. | BACK-1 | |
| H5 | App: the switch and "changed in Google Calendar" note on the event screen; TestFlight build. | TWO-9, BACK-3,5 | |

About 8–10 days of work, in five PRs.

## 4. Done when
- With only Household turned on in Google Calendar, the coming week
  shows each tennis, swim, soccer and school item once, and each
  hand-made family event once.
- A move in the hub shows in Google within 2 minutes; a move in Google
  shows in the hub within 15 minutes in the day.
- Three syncs in a row create nothing new (DUP2-1, in tests and in the
  production run log).

## 5. Status
Approved 2026-10-17 with the defaults (all seven open questions; T-1..T-6 accepted). H1 built (#154): migration 0035 `household_links`, `src/domain/household-sync.ts`, `householdWriter` in `src/adapters/google-calendar/writer.ts`. As built: a linked twin that leaves the hub is untagged, never deleted; the brake counts changes to events already in Google, not new ones. H2 built: job `household:sync` (`src/worker/household-sync.ts`), settings and routes (`src/server/household-sync.ts`, `/api/v1/household-sync`), Settings → "Household calendar, both ways"; Off in production until the owner chooses Dry run. As built: Cookie keeps writing her adds herself (spec §3); the read skipping hub-written events moved here from H3, the copy switching off from H4. H3 next.
