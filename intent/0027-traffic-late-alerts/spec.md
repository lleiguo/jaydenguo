# Spec: Tell me when to leave, and when I'm running late, from live traffic
Status: approved (owner, 2026-10-27, in chat: "intent approved, build it"); T-1..T-5 recommendations accepted. Written by Claude from [intent.md](intent.md).

Read with 0001 (CON-1 places and buffers, CAL-3, CAL-9), 0004 (PUSH-1..6) and
0023 (NTF-SEC1, `OPT_IN_KINDS`). IDs here: TRF (traffic alerts),
TRFSEC (security and privacy).

## 1. What changes in earlier specs
- **0001 CON-1** Stays as it is. (As built: saved places have no screen
  and clashes stopped reading them on 2026-09-28, so home is an address in
  Settings → General instead of a flag on a saved place.)
- **0004 PUSH-1** Adds kind `leave`, opt-in (listed in `extra`, like 0025's
  `mail`: `more` never gains a kind). PUSH-2 unchanged.
- **0004 PUSH-4** A `leave` push opens the event.

## 2. Requirements

### 2.1 Which events (TRF-E)
| ID | Requirement | Acceptance criteria |
|---|---|---|
| TRF-E1 | Candidates. | Timed (not all-day), not skipped or deleted, not a school period, starting in the next 2 hours, attendance `required`, owned by a person in the phone's chosen people (default: everyone). |
| TRF-E2 | A destination. | The event's location text (`location_name`). No location, or the route service can't resolve it → no push, logged once per event as `leave: no route` (without the address). |
| TRF-E3 | Back to back. | If the phone's previous candidate event ends within 2 hours before this one and hasn't ended yet, the origin is that event's place, not the phone's place. (As built: once it has ended the phone is there, so its fresh place is used.) |

### 2.2 Drive time (TRF-R)
| ID | Requirement | Acceptance criteria |
|---|---|---|
| TRF-R1 | Live traffic. | Drive time from a traffic-aware route (Google Routes `computeRoutes`, `TRAFFIC_AWARE`, departure now) from the origin to the destination. |
| TRF-R2 | Origin. | The phone's latest place if reported in the last 30 min; else home (the address in Settings → General); else no push. |
| TRF-R3 | Few calls. | At most one route call per phone per event per 10 min (every 30 min until 40 min before leave-by), and none for events more than 2 h away. A test with 3 events a day for 30 days stays under 1,500 calls. |
| TRF-R4 | Failure. | A route error skips that run (no push, no retry storm); 3 failures in a row for the same event push nothing and log once. |

### 2.3 Pushes (TRF-P)
| ID | Requirement | Acceptance criteria |
|---|---|---|
| TRF-P1 | Leave by. | leave-by = start − drive time − 5 min. When now ≥ leave-by − 10 min, push once per phone per event, kind `leave`: "Leave by 3:42 for <title>", body "<place>: 28 min with traffic". Opens the event. |
| TRF-P2 | Traffic got worse. | If, after TRF-P1, leave-by moves 10+ min earlier, push once more: "Leave by 3:32 for <title>" (or "Leave now …"), body "Traffic is heavier: 38 min with traffic to <place>". |
| TRF-P3 | Running late. | After leave-by, if the phone's place is fresh and it is still within 300 m of the origin used for TRF-P1, and the arrival (now + drive time) is after start, push once: "Leave now: you'll get to <title> at 4:07, 7 min late". With no fresh place, no running-late push. |
| TRF-P4 | Quiet when moving or there. | No TRF-P2/P3 once the phone is more than 300 m from the origin, or within 300 m of the destination. (As built: any move of 300 m counts as on the way; the destination is known only on a run that routes.) |
| TRF-P5 | At most three. | No more than 3 `leave` pushes per phone per event; none after the event starts. |

### 2.4 iPhone (TRF-A)
| ID | Requirement | Acceptance criteria |
|---|---|---|
| TRF-A1 | Turn on. | Settings → Notifications shows "Time to leave" (off). Turning it on asks for location ("While using", then offers "Always" with one sentence why). Denied → the switch stays on, home is used, and Settings says so. |
| TRF-A2 | Report place. | With the kind on, the app sends its place (rounded to ~100 m) on launch, on significant location changes, and at most every 5 min while open: `POST /api/v1/devices/current/location`. Turning the kind off sends `DELETE` and stops. |
| TRF-A3 | Choose people. | Settings → Time to leave lists the household's people as switches (default all on). |
| TRF-A4 | Home address. | Settings → General on the web has "Home address, for Time to leave"; `PATCH /api/v1/settings` takes `homeAddress` (empty clears it), `GET` returns it. |

### 2.5 Security and privacy (TRFSEC)
| ID | Requirement | Acceptance criteria |
|---|---|---|
| TRFSEC-1 | Latest place only. | One row per device; each report overwrites it; rows older than 24 h are deleted by the job; no history table. |
| TRFSEC-2 | Never logged or pushed. | Logs carry event id and minutes, never coordinates or addresses; push payloads carry id and kind only (PUSH-2). A test greps logs from a run for coordinates. |
| TRFSEC-3 | Own device only. | The location route takes the device from the session; one parent can't write or read another's. |
| TRFSEC-4 | Key. | The Routes API key is restricted to the Routes API, kept in Secret Manager, read by the worker only. |

## 3. Design
- **Data.** `device_locations (device_id pk → devices, lat, lng,
  accuracy_m, reported_at)`; `devices.leave_people uuid[]` (empty = all);
  setting `home_address`; `leave_alerts (device_id, event_id) pk` with
  the last route time, drive minutes, failures, the origin and leave-by of
  the first push and which pushes went (P2–P5 read it); the notification
  log dedups each push (`leave:<device>:<event>:<step>`).
  One migration (`pnpm db:generate --name leave_alerts_0027`); kind check
  constraint gains `leave`.
- **Job.** Worker job `leave:check`, Cloud Scheduler every 5 min from
  06:00 to 22:00 local. For each device with `leave` on: candidates
  (TRF-E), route if due (TRF-R3), decide P1–P5, send through the
  existing push sender.
- **Routes client.** `src/server/traffic/routes.ts`, one function
  `driveMinutes(origin, destination)`; a fake for tests.
- **API.** `POST/DELETE /api/v1/devices/current/location` (OpenAPI
  updated); `leave_people` on `PATCH /api/v1/devices/current`.
- **iPhone.** CoreLocation significant-change monitoring when the kind
  is on; the two Settings screens; `leave` target = event. Build bump
  and TestFlight after.
- **Infra.** Enable `routes.googleapis.com`, an API key restricted to
  it, its secret, the scheduler job. Terraform apply by the owner.

## 4. Testing
- Unit: leave-by maths, back-to-back origin, P1–P5 decision table
  (moving, arrived, stale place, traffic worse, cap of 3), text.
- Integration (test DB, fake Routes, fake APNs): one P1 per event; P2
  only on a 10-min jump; P3 only when stationary and late; call budget
  (TRF-R3); 24 h deletion; another parent's device can't be written;
  logs have no coordinates.
- iOS: HubKit decode, the permission flow in the simulator (simulated
  location), screenshot of Settings.
- Production: owner turns it on, a real event with a place; reported as
  waiting on the owner until a leave-by push arrives.

## 5. Concerns for the owner
| # | Concern | Recommendation |
|---|---|---|
| T-1 | Your phone's location goes to our server. | Latest place only, rounded, 24 h, never logged (TRFSEC). Off until you turn it on. |
| T-2 | "Always" location is needed for running-late; iOS reminds you about it now and then. | Offer it, but keep everything else working with "While using" plus home. |
| T-3 | Routes API costs money past the free tier. | Budget in TRF-R3 keeps it to ~1,500 calls a month, well inside the free tier; add a GCP budget alert at $5. |
| T-4 | Location text from imported calendars can be vague ("Field 3"). | Put an address in the event's location; vague ones get no push rather than a wrong one. |
| T-5 | iOS only wakes the app on significant moves (~500 m), so "still at home" can be stale by minutes. | Good enough for a 300 m test; the app also reports when opened. |
