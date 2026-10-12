# Plan: His tests and homework from Google Classroom
Status: draft (2026-10-12), with [spec.md](spec.md).

Order: find out whether Google lets the worker sign in at all (SP-C3)
before building the rest; then reading, then what's shown, then Cookie.

## 1. What the owner does
| # | Step | Needed for |
|---|---|---|
| O-1 | Tell him the hub will sign in to his Classroom to read it. | CW1 |
| O-2 | After CW1 deploys: Accounts → "Google Classroom (school login)", enter his email and password, owner = him, then Test connection; approve the sign-in on your phone when Google asks (or type a code). | SP-C3 |
| O-3 | Optional: ask the school's IT to approve `jaydenguo.com` (then the API can replace the stored login). | — |
| O-4 | Switch off clubs and house classes on the source. | CW2 |
| O-5 | Install the TestFlight build with homework on Today. | CW2 on iPhone |

## 2. Spikes
| # | Question | How | Blocks |
|---|---|---|---|
| SP-C1 | Can his school account grant the Classroom API? | Connect button (0001 M4.1). | **Blocked**, see Status. |
| SP-C2 | Other routes: Veracross, guardian emails, class calendar feeds? | Looked 2026-10-12. | **None**, see Status. |
| SP-C3 | Does Google let the worker sign in as him with a plain browser, and does a saved session last? | CW1's Test connection on production (O-2); record what Google showed (expected: a phone approval) and, over the next days, whether scheduled runs reuse the session without asking again. | CW2 |

## 3. Milestones
| # | What | Spec | PR |
|---|---|---|---|
| CW1 | Credential, sign-in with saved session and code entry, challenge handling, Test connection; `school_work` table; To-do parsing; sync. | CW-1..CW-6, CW-9, CWSEC | |
| CW2 | Tests and quizzes as all-day events; Homework and Missing on Today (web, API, iPhone); links; TestFlight build. | CW-7, CW-8 | |
| CW3 | Cookie's school tool gains `classwork`; eval. | CW-8 | |

If SP-C3 shows Google challenges every sign-in, stop after CW1: the
source stays off, and the owner chooses between IT approval and a
morning read on his Mac (a new intent).

## 4. Done when
- On production his next Physics test shows as "Test · Physics 11: …" on
  its day, and his Today card lists homework due this week and only real
  missing work.
- Cookie answers "When's his next physics test?" with the day and topic.

## 5. Status
Draft. Waiting on the owner's approval of intent, spec and plan.

- **SP-C1: blocked (2026-10-12).** Google showed "Access blocked: Your
  institution's admin needs to review jaydenguo.com".
- **SP-C2: no other route (2026-10-12).** No guardian emails in the
  owner's Gmail; Veracross doesn't have his Classroom work (the owner
  looked); the class calendars have no iCal address, aren't public
  (their public feed is 404) and the owner's account can't see them.
- **Route chosen (owner, 2026-10-12):** sign in from the worker with his
  stored school login (intent, "How the hub reads it").
