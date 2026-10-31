# Plan: U12 green events count for Jayden
Status: draft (2026-10-31), with [spec.md](spec.md).

Order: the spike first, because the search needs its answer; then one small
change, so one PR.

## 1. What the owner does
| # | Step | Needed for |
|---|---|---|
| O-1 | Approve this and answer the three questions in [intent.md](intent.md). | U1 |
| O-2 | After the next refresh, check Upcoming on the Tennis page for U12 green tournaments that should be left out. | After U1 |

## 2. Spikes
| # | Question | How | Blocks |
|---|---|---|---|
| SP-U1 | What value does the site's search form use for the U12 age group? U10 is "10", so "12" is likely but unchecked. | Read the options on the public search page. | U1 |

## 3. Milestones
| # | What | Spec | PR |
|---|---|---|---|
| U1 | Age check and order in `pickEvent`, U12 search, Sources page sentence, data migration, tests. | UGR-1..5 | |

## 4. Done when
- On production, after a refresh, no upcoming tournament with a U12 green event
  for him is skipped as "No event for him".
- The next Thursday job treats those tournaments as it does other green ones.

## 5. Status
Draft. Waiting on the owner's approval of intent, spec and plan.
