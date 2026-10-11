# Plan: One event per lesson, however many emails
Status: approved (owner, 2026-10-11, in chat: "draft intent and go ahead and implement it"), with [spec.md](spec.md).

Order: the calendar rule first (it fixes what's already there), then the
reader and the suggestion hint.

## 1. What the owner does
| # | Step | Needed for |
|---|---|---|
| O-1 | Skip the stale 10:00 lesson on Oct 18; move the household "Jayden Tennis - Jianyu" to 11:00. | Oct 18 |
| O-2 | Install the TestFlight build with the iPhone caption. | D2 on iPhone |

## 2. Spikes
None.

## 3. Milestones
| # | What | Spec | PR |
|---|---|---|---|
| D1 | Calendar rule: email twins, email gives way to feeds. | DUP-5, DUP-6 | |
| D2 | Reader: local times, repeat and reschedule rules; `similar` on suggestions, shown on web, iPhone and Cookie. | DUP-1..DUP-4 | |

## 4. Done when
- Oct 18 on production shows one 11–12 private lesson and no clash
  between the two 11:00 copies.
- A pending new suggestion over an existing event says "Already on the
  calendar".

## 5. Status
Approved 2026-10-11. D1 next.
