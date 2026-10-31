# Plan: U12 orange and green events count for Jayden
Status: approved (owner, 2026-10-31, in chat: "Approve defaults", then "U12 Orange or Green are fine"): enter U12 events automatically, also search the U12 age group, closest tournament wins on a shared weekend. With [spec.md](spec.md).

Order: the spike first, because the search needs its answer; then one small
change, so one PR.

## 1. What the owner does
| # | Step | Needed for |
|---|---|---|
| O-1 | Approve this and answer the three questions in [intent.md](intent.md). Done 2026-10-31. | U1 |
| O-2 | After the next refresh, check Upcoming on the Tennis page for U12 tournaments that should be left out. | After U1 |

## 2. Spikes
| # | Question | How | Blocks |
|---|---|---|---|
| SP-U1 | What value does the site's search form use for the U12 age group? U10 is "10", so "12" is likely but unchecked. | Read the options on the public search page. | U1 |

## 3. Milestones
| # | What | Spec | PR |
|---|---|---|---|
| U1 | Age limit and order in `pickEvent`, U12 search, Sources page sentence, data migration, tests. | UGR-1..5 | |

## 4. Done when
- On production, after a refresh, no upcoming tournament with a U12 orange or
  green event for him is skipped as "No event for him".
- The next Thursday job treats those tournaments as it does his other ones.

## 5. Status
Approved 2026-10-31. SP-U1, then U1 next.
