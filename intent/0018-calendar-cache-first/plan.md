# Plan: The saved calendar first, on any connection
Status: approved (owner, 2026-10-16, in chat: "approve, defaults"), with [spec.md](spec.md).

Order: one app change, then the TestFlight build. No server work.

## 1. What the owner does
| # | Step | Needed for |
|---|---|---|
| O-1 | Install the TestFlight build; in Airplane mode, open the Calendar tab and check it shows at once with the banner. | Done |

## 2. Spikes
None.

## 3. Milestones
| # | What | Spec | PR |
|---|---|---|---|
| S1 | HubKit `SavedCalendar` + tests; `CalendarStore` shows it first, refreshes behind it, 8 s banner; UI test in `OfflineTests`. | SAV-1..5, SAVSEC-1 | |
| S2 | Bump `CURRENT_PROJECT_VERSION`, archive and upload to TestFlight. | | |

## 4. Done when
- In Airplane mode, a cold launch shows the calendar with "Offline,
  updated …" and no error, including on a Monday after the last load.
- On a slow connection the calendar is on screen at once and the banner
  appears within ~8 s; a late answer replaces it.

## 5. Status
Approved 2026-10-16 with the defaults (8 s, one saved copy, no spinner; S-1, S-2 accepted). S1 next.
