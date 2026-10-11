# Intent: One event per lesson, however many emails
Status: approved (owner, 2026-10-11, in chat: "draft intent and go ahead and implement it"). Drafted by Claude from the owner's request.
Owner: Jayden's parent (lleiguo).

"look at the deduplication logic, it doesn't always works, e.g. Oct 18 has
a clash between two events which are clearly duplicates, those should be
de-duplicated, de-duplication can be done through LLM?"

## Problem
- On Oct 18 the calendar showed one private tennis lesson three times:
  10–11 and twice at 11–12, with a clash between the two 11–12 copies.
- All three came from coach emails (0001 EML-2, EML-3): the booking
  (10:00), a "still needs paying" reminder, and "Rescheduled to 11:00 AM".
  The email reader offered each as a **new** event. The reminder wasn't
  new, and the reschedule should have **moved** the 10:00 event.
- The reader is shown the upcoming events with UTC start times and no
  end, so "Sun, Oct 18 at 10:00 AM" doesn't obviously match
  "2026-10-18T17:00:00Z".
- The calendar's duplicate rule (PR #43, #64) only hides household
  calendar events. Two events from the same email source are never
  compared, however alike.

## Proposed outcome
- **The email reader knows what's already there.** It sees upcoming
  events in local time, with end time and where they came from. An email
  about an event already listed with nothing new (a reminder, a payment
  request, a receipt) gives no suggestion; a new time for a listed event
  is a change of it, not a new event.
- **The suggestion says when it looks like a repeat.** A new-event
  suggestion that lands on an event already on the calendar (same person,
  same activity, overlapping time) says "Already on the calendar: …" on
  the web, the iPhone and to Cookie, so it's easy to reject.
- **The calendar shows email events once.** Two events from email for the
  same person, activity and time show once (the latest approved), and an
  email event gives way to the same event from a club or school feed, as
  the household calendar does.
- **Not here.** An LLM judging duplicates every time the calendar loads
  (slow, costs on each load, and could answer differently each time);
  merging or deleting stored events.

## Constraints
- The LLM stays where it already runs: once per email (Gemini Flash,
  0008 EMS-1). No new model calls on calendar loads.
- Nothing is deleted: duplicates are hidden from view, as household ones
  are (0001 CAL-6).
- Nothing reaches the calendar without approval (0001 EML-3).

## Open questions (defaults in brackets)
1. Which email copy stays? [The one approved last: later emails supersede
   earlier ones, like the reschedule here.]
2. Should a "new" suggestion that overlaps an existing event be turned
   into a change automatically? [No: it's shown as "Already on the
   calendar" and the owner decides.]
3. Re-read the emails already read with the new instructions? [No: the
   calendar rule hides the copies already there; new emails get the new
   reader.]
