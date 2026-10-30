# Plan: Green ball tournaments count for Jayden
Status: approved (owner, 2026-10-30, in chat: "Approve intent 0028 with the defaults: enter green events automatically, closest tournament wins on a shared weekend, and events only for ages over 10 stay out."), with [spec.md](spec.md).

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
| G1 | `pickEvent` order and age check, new defaults, Sources page, data migration, tests. | GRN-1..6 | [#214](https://github.com/lleiguo/jaydenguo/pull/214) |

## 4. Done when
- On production, the tennis settings show "orange, green" (or the owner's
  own words), and after a refresh no upcoming tournament with a green event
  for him is skipped as "No event for him".
- The next Thursday job treats those tournaments as it does orange ones.

## 5. Status
Approved 2026-10-30. G1 merged and deployed 2026-10-30 (#214). The owner's check of the Sources page and the Tennis page after the next refresh is left (O-2, section 4).
