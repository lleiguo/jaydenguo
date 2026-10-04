# Plan: Past suggestions clear, skipped events hide
Status: approved (owner, 2026-10-03, in chat: "Approve, defaults"), with [spec.md](spec.md).

Order: one small PR; no schema or infra change.

## 1. What the owner does
| # | Step | Needed for |
|---|---|---|
| O-1 | Approve these docs. | T1 |
| O-2 | Install TestFlight build with the iPhone toggle. | done |

## 2. Spikes
None.

## 3. Milestones
| # | What | Spec | PR |
|---|---|---|---|
| T1 | Past suggestions clear; skipped hidden with a toggle (web + iPhone). | TID-1..4 | #97 |
| T2 | TestFlight build bump. | — | #98 |

## 4. Done when
- Last week's suggestions are gone from the list and counts, shown as Past.
- The agenda shows no skipped rows until the toggle is on.

## 5. Status
T1 merged (#97) and deployed 2026-10-03; build bumped to 10 (#98). Left for
the owner: the production check while signed in (Suggestions page, the
Skipped chip), and the TestFlight upload of build 10, which needs Xcode →
Settings → Accounts signed in again for team 5NQND46R49 (the archive from
f402088 is built).
