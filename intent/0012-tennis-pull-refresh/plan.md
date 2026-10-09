# Plan: Pull down to refresh his tennis entries
Status: draft (2026-10-09), with [spec.md](spec.md).

Order: the server check first, then the iPhone app.

## 1. What the owner does
| # | Step | Needed for |
|---|---|---|
| O-1 | Approve these docs (and answer the open questions, or keep the defaults). | P1 |
| O-2 | Install the TestFlight build with pull to refresh. | P2 |

## 2. Spikes
| # | Question | How | Blocks |
|---|---|---|---|
| SP-P1 | Can a draw already in be re-read alone (bracket or match list, his next match) without the profile walk? | Read the adapter's draw parsers against the fixture pages. | P1's draw step |

## 3. Milestones
| # | What | Spec | PR |
|---|---|---|---|
| P1 | `tennis:check` job, `tennis_checks` table, API, 5-minute limit, draw step. | TPR-2..4, TPR-6 | |
| P2 | iPhone: pull to refresh runs the check (Refresh button kept for the full sync); TestFlight bump. | TPR-1, TPR-5, TPR-6 | |

## 4. Done when
- Pulling down on the iPhone Tennis screen shows new entries and list
  places in under a minute; the Refresh button still runs the full sync.
- The job's log shows no tournament search and under 15 requests for
  his 4 entries.

## 5. Status
Draft. Waiting on the owner's approval of intent, spec and plan.
