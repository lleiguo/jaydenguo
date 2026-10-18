# Intent: School stays out of the household calendar
Status: draft (2026-10-18). Drafted by Claude from the owner's request.
Owner: Jayden's parent (lleiguo).

"one more tweak, for the kids school (Ethan/Jayden) school, no need to sync to household calendar"

## Problem
Two-way sync (intent 0020) writes a "School" block per child per school
day into the household Google Calendar, and school closures as
themselves (0020 TWO-5). That is most of the week, every week, for both
boys, and the family doesn't need it in Household: school is the same
every day, and the hub already shows it.

## Proposed outcome
- **No school in Household.** The boys' classes and school closures stay
  in the hub (website, app, Cookie) and are no longer written to the
  household Google Calendar.
- **What was written goes.** School blocks and closures the sync already
  put in Household from today on are deleted from it; past days stay
  (0020 TWO-7).
- **Everything else as before.** Tennis, swim, soccer, hand-made family
  events and the rest still go both ways.
- **Not here:** a setting to choose categories; leaving out other things.

## Constraints
- 0020's fence and brake hold: only events the hub wrote are deleted, and
  a run that would delete more than 10 is held for the owner's "Apply
  anyway" (TWSEC-2).

## Open questions (defaults in brackets)
1. Do school closures (PD days, holidays) also stay out? [Yes: they are
   school too. Other school-calendar items the hub files under another
   category, such as a picture day, still go.]
