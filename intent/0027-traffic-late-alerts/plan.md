# Plan: Tell me when to leave, and when I'm running late, from live traffic
Status: approved (owner, 2026-10-27, in chat: "intent approved, build it"), with [spec.md](spec.md).

Order: server first (works from home with no app change), then the app's
location and settings, then infra goes live.

## 1. What the owner does
| # | Step | Needed for |
|---|---|---|
| O-1 | Answer the intent's questions (or "defaults"). | all |
| O-2 | Terraform apply: Routes API, key secret, scheduler job. | TL4 |
| O-3 | Type the home address in Settings → General. | prod test |
| O-4 | Install the TestFlight build, turn on "Time to leave", allow location. | prod test |

## 2. Spikes
| # | Question | How | Blocks |
|---|---|---|---|
| SP-T1 | Does Routes resolve our event location texts, and what does a call cost? | Run `computeRoutes` against the next month's real event locations from a dev key; count resolved vs not. | TL2 |
| SP-T2 | How fresh is significant-change location on the owner's iPhone? | Simulator plus a day on the phone in a debug build. | TL3 |

## 3. Milestones
| # | What | Spec | PR |
|---|---|---|---|
| TL1 | Schema (device_locations, leave_alerts, leave_people, kind `leave`), location API, home address on the web. | TRF-A4, TRFSEC-1..3 | |
| TL2 | Routes client, `leave:check` job, decision table, pushes. | TRF-E, TRF-R, TRF-P, TRFSEC-2 | |
| TL3 | iPhone: kind switch, location permission and reporting, people, home; build bump, TestFlight. | TRF-A1..A4 | |
| TL4 | Infra: API, key, secret, scheduler. | TRFSEC-4 | |

## 4. Done when
- A leave-by push arrives on the owner's iPhone before a real event with
  a place, with a drive time that matches Maps within a few minutes.
- Staying put past leave-by brings the running-late push; leaving
  doesn't.
- No coordinates in production logs; device_locations holds at most one
  row per phone, none older than 24 h.

## 5. Status
Approved 2026-10-27. TL1 built (schema, location API, home address).
