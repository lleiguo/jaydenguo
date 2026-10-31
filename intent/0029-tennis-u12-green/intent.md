# Intent: U12 green events count for Jayden
Status: draft (2026-10-31). Drafted by Claude from the owner's request.
Owner: Jayden's parent (lleiguo).

"U12 green event should be included"

## Problem
Intent 0028 let green events fit him, but kept out any event whose ages are
all over 10, naming "U12 Green" as an example. So:

- A tournament whose only green event for boys is "U12 Green" or
  "BS 12 - Green" is skipped as "No event for him", and isn't read again.
- The search only asks the site for its U10 age group, so a tournament with
  nothing for under-10s isn't found at all.

## Proposed outcome
- **U12 green fits.** "U12 Green" and "BS 12 - Green" are treated as other
  green events: listed under Upcoming, entered on Thursday once entry opens,
  and shown with the link if the app can't finish.
- **His own age still comes first.** Orange beats green, as today. Between
  green events, U10 or younger beats U12.
- **Only green.** Orange events for older ages, green events over 12, and
  girls' and doubles events stay out.
- **The search finds them.** It also asks for the site's U12 age group.
- **The ones already skipped come back.** Upcoming tournaments skipped for
  having no event for him are read again on the next refresh.
- **Not here:** a change to the drive limit, the Thursday schedule, or the
  rule for two tournaments on the same weekend.

## Constraints
- Words the owner has written on the Sources page stay as they are.
- Tournaments that have passed stay in Skipped as they are.

## Open questions (defaults in brackets)
1. Should the app enter him in U12 green events by itself, or only list them
   for the owner to enter? [Enter by itself, as for other green events.]
2. Should the search also look at the U12 age group, adding tournaments that
   have nothing for under-10s? [Yes: otherwise a U12-only tournament is never
   seen. More tournaments may then be entered, and entries can cost money.]
3. On a weekend with a U10 tournament and a U12 green one, which one?
   [Unchanged: the closest wins, and one he's already in stays. Say if his
   own age should always win.]
