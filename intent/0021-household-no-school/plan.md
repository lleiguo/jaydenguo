# Plan: School stays out of the household calendar
Status: approved (owner, 2026-10-18, in chat: "approve intent 0021 with the defaults (closures stay out too)"), with [spec.md](spec.md).

Order: one small PR; nothing for the owner unless a run is held.

## 1. What the owner does
| # | Step | Needed for |
|---|---|---|
| O-1 | If a run is held for school deletes, check the list and choose "Apply anyway". | NO1 done |

## 2. Spikes
None.

## 3. Milestones
| # | What | Spec | PR |
|---|---|---|---|
| NO1 | `LEFT_OUT` in the planner and `readBack`; unit test. | NOS-1..3 | #161 |

## 4. Done when
- A dry run lists no "School" creates or changes.
- Household shows no school from today on after the next run.

## 5. Status
Approved 2026-10-18 with the defaults (closures stay out too). NO1 built
in #161: `LEFT_OUT` in `planHousehold` and `readBack`
(`src/domain/household-sync.ts`).
