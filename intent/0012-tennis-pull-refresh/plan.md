# Plan: Pull down to refresh his tennis entries
Status: approved (owner, 2026-10-09, in chat: "approve, defaults"; question 3: "keep the refresh button for full sync on both mobile and web"), with [spec.md](spec.md).

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

**SP-P1 (2026-10-09): yes.** The sync already reads each draw on its own
(`GetDrawContent`, else `GetMatchesContent`) and replaces stored draws per
tournament. The catch: a run cancels his stored tournaments and matches it
didn't return. So the draw-only read (`syncTennisDraws`) reads his profile,
this year's tournaments and only the scoped ones (and up to 4 next
opponents), and the batch carries a `scope` so nothing outside those
tournaments is cancelled. It skips the calendar (the next full sync updates
match times there) and writes no sync run.

## 3. Milestones
| # | What | Spec | PR |
|---|---|---|---|
| P1 | `tennis:check` job, `tennis_checks` table (migration 0032), API, 5-minute limit, draw step. | TPR-2..4, TPR-6 | (this PR) |
| P2 | iPhone: pull to refresh runs the check (Refresh button kept for the full sync); TestFlight bump. | TPR-1, TPR-5, TPR-6 | (this PR); bump separate |

## 4. Done when
- Pulling down on the iPhone Tennis screen shows new entries and list
  places in under a minute; the Refresh button still runs the full sync.
- The job's log shows no tournament search and under 15 requests for
  his 4 entries.

## 5. Status
Approved 2026-10-09 with the defaults. P1 built (unit + integration green); P2 built (simulator build green).
