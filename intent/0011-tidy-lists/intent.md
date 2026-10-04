# Intent: Past suggestions clear, skipped events hide
Status: draft (2026-10-03). Drafted by Claude from the owner's request.
Owner: Jayden's parent (lleiguo).

"for email suggestions, if it's in the past, clear it"

"for agenda/calendar, by default, hide "skipped", but give an icon/option
to make skipped visible"

## Problem
- **Email suggestions** (0001 EML-2, EML-3) wait for approve or reject
  however old they get. A suggestion for last week's practice still sits
  on the Suggestions page, counts on Today and in More, and Cookie reads
  it out (0008 EMS-2). Nobody needs to decide on something that's over.
- **Skipped events** (0001 CON-4, 0004 ICAL-5) stay on the calendar, faded
  and struck through. Once a whole series is skipped ("skip every
  repeat"), the agenda fills with rows nobody is going to.

## Proposed outcome
- **Past suggestions clear themselves.** A suggestion about a day before
  today leaves the waiting list, the counts and Cookie's list. It shows
  under "Recently decided" as "Past", so nothing vanishes without trace.
- **Skipped events are hidden by default** on the calendar, in every view
  (agenda, day, week, month), on the web and in the iPhone app.
- **One tap shows them again.** A "Skipped" toggle beside Filters (web)
  and "Show skipped" in the calendar's menu (iPhone). Shown, they look as
  they do today (faded, struck through) and can be un-skipped. The choice
  is remembered per device.
- **Not here.** Deleting suggestions or events. The widgets and Today,
  which already leave skipped events out.

## Constraints
- No database change: "past" is worked out when the list is read.
- Skipping is still only the owner's own override; sources aren't touched.

## Open questions (defaults in brackets)
1. When is a suggestion "past"? [When the day it names is before today in
   the home time zone; today's still waits. With no day, the day of the
   event it changes or cancels. With neither, it waits as now.]
2. Do cleared ones show under "Recently decided"? [Yes, marked "Past",
   with no approve or reject buttons.]
3. Hide skipped in day, week and month too, not only the agenda? [Yes, the
   same toggle for all views.]
