# Plan: Delete any calendar event
Status: draft (2026-10-18), with [spec.md](spec.md).

Order: the server first (the website follows in the same PR), then the
iPhone app, then a TestFlight build.

## 1. What the owner does
| # | Step | Needed for |
|---|---|---|
| O-1 | Install the TestFlight build and delete, then restore, a source event on the phone. | DL2 done |

## 2. Spikes
None.

## 3. Milestones
| # | What | Spec | PR |
|---|---|---|---|
| DL1 | Server and website: `deleteEvent` for any event, household Off/Dry run in the hub only, Cookie's rule kept; one Delete with the confirm on the web; Settings → Deleted shows the source. Integration and e2e tests. | DEL-1..7 | |
| DL2 | iPhone: Delete on every event with the confirm; Deleted shows the source. TestFlight build bump in its own PR. | DEL-2, DEL-5 | |

## 4. Done when
- On production, a school or tennis event deleted on the website is gone
  from every view, stays gone after the next sync, and comes back from
  Settings → Deleted.
- The same works on the phone (O-1).

## 5. Status
Draft. Waiting on the owner's approval of intent, spec and plan.
