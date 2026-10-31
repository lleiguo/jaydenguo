# Spec: U12 green events count for Jayden
Status: draft (2026-10-31). Written by Claude from [intent.md](intent.md).

Read with [0028's spec](../0028-tennis-green-ball/spec.md) and
[0001's spec](../0001-jayden-hub/spec.md) (TEN-9, TEN-12). IDs here: UGR
(U12 green).

## 1. What changes in earlier specs
- **0028 GRN-4** "U12 Green" and "BS 12 - Green" now fit. Older events stay
  out otherwise (UGR-1, UGR-3).
- **0028 G-3** the age limit now depends on the ball colour: 10 for other
  events, 12 for green.
- **0001 TEN-9** the search covers the U12 age group as well as U10 (UGR-4).
- The rest of TEN-9, TEN-12 and 0028 stays as it is, including girls' events
  (GRN-3) and orange before green (GRN-2).

## 2. Requirements

### 2.1 Which event fits him (UGR)
| ID | Requirement | Acceptance criteria |
|---|---|---|
| UGR-1 | U12 green fits. | With default settings, "U12 Green", "BS 12 - Green", "U12 (Green Ball)" and "RT 11 - 12 (Green)" each get picked when they're the tournament's only event for him. |
| UGR-2 | His own age first. | "U12 Green" and "BS 10 - Green" together pick "BS 10 - Green"; "U12 Green" and "U9 Green" pick "U9 Green"; "U12 Green" and "U10 Orange" pick "U10 Orange". |
| UGR-3 | Nothing else older. | "U12 Orange", "U14 Green", "BS 14 - Green" and "RT 13 - 14 (Green)" don't fit. "GS 12 - Green", "GU12 Green" and "U12 Green Doubles" don't fit either: the default "Never events with" already covers all three. The age limits hold whatever the Sources page says. |

### 2.2 Finding them
| ID | Requirement | Acceptance criteria |
|---|---|---|
| UGR-4 | The search covers U12. | The Thursday job and the refresh search both the U10 and the U12 age group. A tournament found by both is handled once. A tournament found only through U12, with a green event for him, is Upcoming or left for the Thursday job. |
| UGR-5 | Skipped ones return. | A tournament that hasn't started, is skipped, and whose note starts "No event for him" is read again on the next Tennis sync, as in GRN-5. Past skipped rows and rows skipped for distance or a clash are untouched. |

## 3. Design
- `src/domain/tennis-entry.ts`: the age check takes the event name and allows
  12 when it has the word "green", 10 otherwise. `pickEvent` tries events in
  his own age range before U12 ones, within the same colour; `prefer` still
  decides inside each.
- `src/server/tennis/entries.ts`: `searchForm` takes an age group; each search
  runs for "10" and the U12 value, and results are merged by tournament.
  The request cap stays the same.
- `src/components/sources/sources-panel.tsx`: the sentence naming U10
  tournaments says U10 and U12 green.
- A data migration, as 0028 did: UGR-5 deletes those rows so `discover` finds
  them again. No schema change, and no change to saved settings.
- No change to the API or the iPhone app: both already show whatever event
  was picked.

## 4. Testing
Unit: `pickEvent` for every example in UGR-1..3.
Integration: both age groups are searched and a tournament in both is handled
once; a U12-only tournament comes through with its green event; the migration
removes only the rows UGR-5 names.

## 5. Concerns for the owner
| # | Concern | Recommendation |
|---|---|---|
| U-1 | The first Thursday after this ships may enter him in several more tournaments, and entries can cost money. He'd also play older children. | Accept it, or check Upcoming after the first refresh and tell me if any should be left out. |
| U-2 | A weekend's closest tournament may be U12 green when a U10 orange one is further away. | Accept: this keeps the rule 0028 approved. Question 3 in the intent changes it. |
| U-3 | The extra search adds requests to the site on each run. | Accept: still one at a time, under the same cap. |
