# Intent: Green ball tournaments count for Jayden
Status: draft (2026-10-30). Drafted by Claude from the owner's request.
Owner: Jayden's parent (lleiguo).

"for Jayden's tennis, let's include "green" ball tournament into ocnsideration, don't skip those"

## Problem
The tournament jobs only look for events with "orange" in the name
(0001 TEN-9). A tournament that only has a green event is kept as skipped,
"No event for him" (TEN-12), and is never read again, so he misses it even
after the settings change.

Adding the word "green" to the Sources page isn't enough:

- Green events are named differently. "GS 10 - Green" is a girls' event
  and doesn't contain "girl", so it would be picked.
- A tournament found by the U10 search can also have older green events,
  such as "U12 Green".
- With two fitting events, the first on the page wins unless one is "U9",
  so a green event could beat the orange one in the same tournament.

## Proposed outcome
- **Green counts as his.** A tournament with a green event he can play is
  treated as an orange one is today: listed under Upcoming, entered on
  Thursday once entry opens, and shown with its link if the app can't
  finish.
- **Orange still comes first.** In a tournament with both, he gets the
  orange event.
- **Girls' and older events stay out.** "GS 10 - Green" and "U12 Green"
  don't fit him. "BS 10 - Green" and "RT 9 - 12 (Green)" do.
- **The ones already skipped come back.** Upcoming tournaments skipped
  only for having no event for him are read again on the next refresh.
- **Not here:** a change to the drive limit, the Thursday schedule, or the
  rule for two tournaments on the same weekend.

## Constraints
- A word the owner has already changed on the Sources page stays as they
  wrote it; only settings still on the old default follow (as 0025 did).
- Tournaments that have passed stay in Skipped as they are.

## Open questions (defaults in brackets)
1. Should the app enter him in green events by itself, as it does orange,
   or only list them for the owner to enter? [Enter by itself: "don't skip
   those", and the same rule for both colours is simpler.]
2. When an orange and a green tournament fall on the same weekend, which
   one? [Unchanged: the closest wins, and one he's already in stays. Say
   if orange should always win.]
3. How old is too old? [An event whose name only has ages over 10 doesn't
   fit him: he plays U10 today. "RT 9 - 12" fits because it includes 9.]
