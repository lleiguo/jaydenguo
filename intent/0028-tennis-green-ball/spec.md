# Spec: Green ball tournaments count for Jayden
Status: approved (owner, 2026-10-30, in chat: "Approve intent 0028 with the defaults: enter green events automatically, closest tournament wins on a shared weekend, and events only for ages over 10 stay out."). Written by Claude from [intent.md](intent.md).

Read with [0001's spec](../0001-jayden-hub/spec.md) (TEN-9, TEN-12). IDs
here: GRN (green ball).

## 1. What changes in earlier specs
- **0001 TEN-9** his event by default is now: name has "orange" or "green",
  orange first, then "U9"; never girls', doubles or older events (GRN-1..3).
- **0001 TEN-12** green ball is no longer an example of "no event for him"
  (GRN-5).
- The rest of TEN-9 and TEN-12 stays as it is: the U10 search, the drive
  limit, same-weekend tournaments, entering, and the Tennis page sections.

## 2. Requirements

### 2.1 Which event fits him (GRN)
| ID | Requirement | Acceptance criteria |
|---|---|---|
| GRN-1 | Green events fit. | With default settings, "BS 10 - Green", "U10 Green Boys" and "RT 9 - 12 (Green)" each get picked when they're the tournament's only event for him. |
| GRN-2 | Orange first. | The order of the "Event name has one of" words is the order of preference, and the default is "orange, green". Given "U9 Green" and "U10 Orange", the orange event is picked. "U9" still decides between events of the same colour. |
| GRN-3 | Not girls' events. | With default settings, "GS 10 - Green", "GS10 - Green", "GU10 Green" and "U9 Orange Girls" don't fit. "Never events with" defaults to "girl, women, double, gs, gu1, gu9". |
| GRN-4 | Not older events. | An event whose name has age numbers, all over 10, doesn't fit: "U12 Green" and "BS 12 - Green" don't, "RT 9 - 12 (Green)" and a name with no age do. This holds whatever the Sources page says. |

### 2.2 Settings and skipped tournaments
| ID | Requirement | Acceptance criteria |
|---|---|---|
| GRN-5 | Skipped ones return. | A tournament that hasn't started, is skipped, and whose note starts "No event for him" is read again on the next Tennis sync: it's then Upcoming, left for the Thursday job, or skipped again with the same note if there's still nothing for him. Past skipped rows and rows skipped for distance or a clash are untouched. |
| GRN-6 | Saved settings follow. | A saved include of exactly "orange" becomes "orange, green", and a saved exclude of exactly "girl, women, double" becomes the new default. Any other saved value stays. The Sources page shows the new defaults. |

## 3. Design
- `src/domain/tennis-entry.ts`: new defaults; `pickEvent` goes through
  `include` in order and applies `prefer` within the first word that has a
  fitting event; a small age check next to it, with 10 as a constant (the
  search's own U10 is fixed too).
- `src/components/sources/sources-panel.tsx`: new default values, and the
  label says the order matters.
- A data migration, as 0025 did: GRN-5 deletes those rows so `discover`
  finds them again, and GRN-6 updates `sources.config`. No schema change.
- No change to the entry job, the API or the iPhone app: both already show
  whatever event was picked.
- `pickEventOption` already matches green. When the site's entry form has
  both "BS10 - Green" and "GS10 - Green" and the chosen name doesn't say
  which ("RT 9 - 12 (Green)"), it returns no option. The tournament then
  shows on the Tennis page with its link, which is the safe side.

## 4. Testing
Unit: `pickEvent` for every example in GRN-1..4, and the existing orange
cases unchanged except the one that picks "U19 Orange", which GRN-4 changes.
Integration: the migration removes only the rows GRN-5 names and changes
only the settings GRN-6 names; a removed row comes back through `discover`
with its green event.
E2e: the Skipped section's example stops using a green event as its reason.

## 5. Concerns for the owner
| # | Concern | Recommendation |
|---|---|---|
| G-1 | The first Thursday after this ships may enter him in several green tournaments at once, and entries can cost money. | Accept it, or check Upcoming after the first refresh and tell me if any should be left out. The same-weekend and drive rules still limit it. |
| G-2 | A girls' event named some other way ("G10 Green") would still fit. | Accept: no such name has been seen. A word added to "Never events with" fixes it without code. |
| G-3 | When he turns 11, GRN-4's limit needs changing, along with the U10 search. | Accept: both are fixed for now and change together. |
