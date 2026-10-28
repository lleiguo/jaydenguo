# Plan: Tell me when to leave, and when I'm running late, from live traffic
Status: approved (owner, 2026-10-27, in chat: "intent approved, build it"), with [spec.md](spec.md).

Order: server first (works from home with no app change), then the app's
location and settings, then infra goes live.

## 1. What the owner does
| # | Step | Needed for |
|---|---|---|
| O-1 | Answer the intent's questions (or "defaults"). | all |
| O-2 | Terraform apply: the `leave-check` scheduler job. | TL4 |
| O-3 | Type the home address in Settings → General. | prod test |
| O-4 | Install the TestFlight build, turn on "Time to leave", allow location. | prod test |

## 2. Spikes
| # | Question | How | Blocks |
|---|---|---|---|
| SP-T1 | Does Routes resolve our event location texts, and what does a call cost? | As built: answered in production rather than from a dev key (that would mean copying real event locations off the server): count `leave: no route` against `leave: sent` in the worker logs over the first week. Calls are the TEN-9 Routes SKU at ~6 per event per phone. | after TL4 |
| SP-T2 | How fresh is significant-change location on the owner's iPhone? | Simulator plus a day on the phone in a debug build. | TL3 |

## 3. Milestones
| # | What | Spec | PR |
|---|---|---|---|
| TL1 | Schema (device_locations, leave_alerts, leave_people, kind `leave`), location API, home address on the web. | TRF-A4, TRFSEC-1..3 | |
| TL2 | Routes client, `leave:check` job, decision table, pushes. | TRF-E, TRF-R, TRF-P, TRFSEC-2 | |
| TL3 | iPhone: kind switch, location permission and reporting, people, home; build bump, TestFlight. | TRF-A1..A4 | |
| TL4 | Infra: the scheduler job (the Routes API and the worker's access exist for TEN-9; no key). Built with TL2. | TRF-R3, TRFSEC-4 | |

## 4. Done when
- A leave-by push arrives on the owner's iPhone before a real event with
  a place, with a drive time that matches Maps within a few minutes.
- Staying put past leave-by brings the running-late push; leaving
  doesn't.
- No coordinates in production logs; device_locations holds at most one
  row per phone, none older than 24 h.

## 5. Status
Approved 2026-10-27. TL1 built (schema, location API, home address). TL2 built (Routes client, `leave:check` job, pushes); goes live with TL4. TL3 built (the switch shows from `extra`; location permission and reporting, Time to leave section with whose events); SP-T2 is checked on the owner's phone after TestFlight.
