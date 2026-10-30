# Plan: Green ball tournaments count for Jayden
Status: draft (2026-10-30), with [spec.md](spec.md).

Order: one small change, so one PR.

## 1. What the owner does
| # | Step | Needed for |
|---|---|---|
| O-1 | Approve this and answer the three questions in [intent.md](intent.md). | G1 |
| O-2 | If the Sources page's tennis words were changed by hand, add "green" there: GRN-6 leaves them alone. | After G1 |

## 2. Spikes
None. Event names are from the site's pages already read (0001 spikes).

## 3. Milestones
| # | What | Spec | PR |
|---|---|---|---|
| G1 | `pickEvent` order and age check, new defaults, Sources page, data migration, tests. | GRN-1..6 | |

## 4. Done when
- On production, the tennis settings show "orange, green" (or the owner's
  own words), and after a refresh no upcoming tournament with a green event
  for him is skipped as "No event for him".
- The next Thursday job treats those tournaments as it does orange ones.

## 5. Status
Draft. Waiting on the owner's approval of intent, spec and plan.
