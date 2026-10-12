# Plan: His tests and homework from Google Classroom
Status: draft (2026-10-12), with [spec.md](spec.md).

Order: find out whether his school allows the app (SP-C1) before
building anything; then the sync, then what's shown, then Cookie. Each
milestone is useful on its own.

## 1. What the owner does
| # | Step | Needed for |
|---|---|---|
| O-1 | Settings → Accounts → "Connect school account (Classroom)", choose his school account, consent (his password only on Google's page). Report what happens. | SP-C1 |
| O-2 | If blocked: pick a fallback from SP-C2's result; optionally ask the school's IT to trust the app. | CW1 |
| O-3 | After CW1 deploys: add the Classroom source, owner = him; switch off clubs, house and grad-resource classes. | CW2 |
| O-4 | Install the TestFlight build with homework on Today. | CW2 on iPhone |

## 2. Spikes
| # | Question | How | Blocks |
|---|---|---|---|
| SP-C1 | Can his school account grant the two Classroom scopes, and can the hub read his courses and coursework? | O-1 on production; the credential records the course count or Google's refusal (0001 SP-5). Then a one-off read of coursework and submissions for one course, counts only, in spikes.md. | CW1 |
| SP-C2 | Only if SP-C1 is blocked: does Veracross "Upcoming Assignments" list his Classroom work and tests? Does the school send Classroom guardian summaries? | Read his Veracross assignments page with the hub's stored login (counts and one scrubbed title); ask the owner whether guardian emails arrive. | CW1 (fallback) |

## 3. Milestones
| # | What | Spec | PR |
|---|---|---|---|
| CW1 | `school_work` table, adapter calls, `classify`/`topicOf`, `sync:classroom`, source settings (courses, words), errors kept. | CW-1..CW-3, CW-9, CWSEC | |
| CW2 | Tests and quizzes as all-day events; Homework and Missing on the Today card (web, API, iPhone); links. TestFlight build. | CW-4..CW-7 | |
| CW3 | Cookie's school tool gains `classwork`; eval. | CW-8 | |

If SP-C2 picks a fallback, CW1 reads that instead and the spec is
updated in the same PR; CW2 and CW3 stay as they are.

## 4. Done when
- On production, his Wed Oct 14-style Physics test shows as "Test ·
  Physics 11: …" on that day, and his Today card lists homework due this
  week and only real missing work.
- Cookie answers "When's his next physics test?" with the day and topic.

## 5. Status
Draft. Waiting on the owner's approval of intent, spec and plan, and on
O-1 (SP-C1).
