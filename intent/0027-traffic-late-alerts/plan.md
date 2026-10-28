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
| TL1 | Schema (device_locations, leave_alerts, leave_people, kind `leave`), location API, home address on the web. | TRF-A4, TRFSEC-1..3 | #207 |
| TL2 | Routes client, `leave:check` job, decision table, pushes. | TRF-E, TRF-R, TRF-P, TRFSEC-2 | #208 |
| TL3 | iPhone: kind switch, location permission and reporting, people, home; build bump, TestFlight. | TRF-A1..A4 | #209, build 28 #210 |
| TL4 | Infra: the scheduler job (the Routes API and the worker's access exist for TEN-9; no key). Built with TL2. | TRF-R3, TRFSEC-4 | #208 |

## 4. Done when
- A leave-by push arrives on the owner's iPhone before a real event with
  a place, with a drive time that matches Maps within a few minutes.
- Staying put past leave-by brings the running-late push; leaving
  doesn't.
- No coordinates in production logs; device_locations holds at most one
  row per phone, none older than 24 h.

## 5. Status
Approved 2026-10-27. TL1–TL4 merged and deployed 2026-10-27 (#207, #208,
#209); build 28 bump merged (#210), uploaded to TestFlight 2026-10-27. Simulator check against a
local server: the location prompt, the place stored rounded, whose events
saved. Waiting on the owner: Terraform apply for the `leave-check` scheduler job (O-2);
home address on Settings → General (O-3); turn on Time to leave on the
phone (O-4). Then: the first real leave-by push (done-when), SP-T1 from
the worker logs, SP-T2 on the phone.
