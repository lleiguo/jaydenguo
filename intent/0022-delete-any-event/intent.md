# Intent: Delete any calendar event
Status: approved (owner, 2026-10-18, in chat: "Approve intent 0022 with the defaults."). Drafted by Claude from the owner's request.
Owner: Jayden's parent (lleiguo).

"add a "delete" function to calendar event"

Asked which events (2026-10-18, in chat), the owner chose "All source
events": Delete on every event, not only the ones added by hand.

## Problem
Delete is only offered on events added in the hub (0001 CAL-6, 0004
ICAL-6), and on household events on the website when two-way sync is On
(0020 TWO-4). An event from a source (school, tennis, swim, Spordle,
email, the family's Google Calendar) can only be skipped (0001 CON-4).
A skipped event still exists: it is hidden behind the "Skipped" toggle
(0011 TID-3, TID-4), and it still counts as an event. When an event is
simply wrong or not wanted, the owner wants it gone.

## Proposed outcome
- **Delete on every event.** The website and the iPhone app show Delete
  on any event, after "Delete?". It goes from every view, Today, clashes,
  Cookie and the Google copy, as a manual delete does today.
- **It stays deleted.** The next sync doesn't bring it back, even if the
  source still has it or changes it.
- **It can be restored.** Settings → Deleted lists it, with Restore, as
  for manual events. Nothing is ever hard-deleted (CAL-6).
- **Household as today.** With two-way sync On, deleting a household
  event also deletes it in Google (TWO-4); with it Off or Dry run, it is
  deleted in the hub only, and the confirm says so.
- **Not here:** deleting at the source (school, tennis, swim, Spordle are
  read-only); withdrawing a tennis entry; Cookie deleting source events;
  deleting every repeat of a feed's repeating event at once.

## Constraints
- Nothing is hard-deleted; every delete and restore goes in the event's
  history (CAL-6).
- 0020's fence and brake hold for household events (TWSEC-1, TWSEC-2).
- No schema change: `events.deleted_at` already exists.

## Open questions (defaults in brackets)
1. Should a household event be deletable while two-way sync is Off or Dry
   run? [Yes, in the hub only; the confirm says it stays in Google. Today
   the server refuses.]
2. Should Cookie be able to delete source events too? [No: she keeps
   today's rule (her own adds and manual events); she can still skip.]
3. Keep Skip beside Delete? [Yes: Skip means "won't attend", Delete means
   "not an event".]
