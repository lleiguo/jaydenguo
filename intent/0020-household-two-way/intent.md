# Intent: One family calendar, both ways
Status: approved (owner, 2026-10-17, in chat: "approve intent 0020 with the defaults"). Drafted by Claude from the owner's request.
Owner: Jayden's parent (lleiguo).

"is there a way to have two way sync between my calendar "household" and
family hub calendar so they're in sync and consolidated so there's no
duplicates?"

Offered a small fix (stop copying household events into the "Jayden
(hub)" calendar) or full two-way sync, the owner chose: "option 2".

## Problem
Today the household Google Calendar and the hub are joined one way only:
- **Household → hub (read).** The hub reads Household once a day and on
  demand (0001 SRC-1, SYNC-5), and never writes to it (GCO-1), apart
  from events Cookie is asked to add (0008 GCW).
- **Hub → "Jayden (hub)" (copy).** Every active event of Jayden's is
  copied to a separate Google calendar the hub created (0001 GCO-1, plan
  M5.9). That includes his events that came *from* Household
  (`src/worker/calendar-copy.ts`), so with both calendars turned on in
  Google or Apple Calendar each of them shows twice.
- **Changes don't travel back.** Moving or skipping a household event in
  the hub is a local override (CON-3, CON-5); Household still has the old
  time. Editing a copied event in Google is overwritten at the next copy.
- **Two places to look.** Tennis, swimming, soccer, school and events
  added in the hub live in one Google calendar; hand-made family events
  in another. The brother's events aren't copied at all (the copy is
  Jayden's only).

## Proposed outcome
- **Household is the one calendar.** Every event the hub knows (feeds,
  events added on the site or by Cookie, applied email suggestions) is
  written into Household, for every person, with the person's name in
  the title. Turning on Household alone in Google or Apple Calendar shows
  the whole family's schedule once.
- **Changes go both ways.** Moving, editing, skipping or deleting an
  event in the hub changes it in Household within about a minute.
  Changing or deleting one in Google Calendar changes it in the hub at
  the next read (every 15 minutes, and on demand).
- **Feeds stay the truth.** For a tennis, swim, soccer or school event a
  Google edit becomes the hub's local override, as a drag does today
  (CON-5): the next feed change is still shown, with the "source changed
  since you moved this" badge.
- **No duplicates.** The hub recognises the events it wrote and never
  reads them back as new ones. A hand-made household event that matches
  a feed's (today's household twins, DUP rules) is linked to the feed
  instead of getting a second copy.
- **The "Jayden (hub)" copy is retired.** It is switched off once
  two-way sync is on; you choose to delete it (GCO-2).
- **Not here:** other Google calendars (a parent's work calendar);
  Apple or Outlook calendars; real-time push from Google (webhooks);
  changing who an event belongs to by editing it in Google beyond the
  name in its title.

## Constraints
- Google permission: `calendar.events.owned`, already granted for Cookie
  (0008 GCW-3, SP-E1). No wider scope.
- Only the worker holds the Google grant (0001 CRED-4, 0008 E-1): hub
  changes reach Google through a worker job, about a minute later.
- No secrets or real personal data in the repo; tests use fakes.
- A schedule change in `infra/` needs the owner's Terraform apply.
- Household is shared with the family: a bug could change or delete
  their hand-made events. The writer is fenced (TWSEC) and starts in a
  dry-run mode the owner checks first.

## Open questions (defaults in brackets)
1. Which hub events go into Household? [All active ones, past 30 days to
   a year ahead, for every person; a school day as one "School" block
   per child, not one event per class.]
2. How often does the hub read Household? [Every 15 minutes from 6 am to
   10 pm, plus on demand (Refresh); a schedule change in
   `infra/`.]
3. When the same event was changed on both sides between two reads,
   which wins? [The later change, by Google's `updated` time against the
   hub's; the event shows "changed in Google Calendar" or "changed in the hub".]
4. Deleting a household event in the hub: delete it in Google? [Yes, with
   the hub's usual "Delete?" confirmation; skipping one occurrence of a
   repeating event cancels only that occurrence in Google.]
5. Repeating events added in the hub: a Google series or single events?
   [Single events, one per occurrence in the window. Simpler and safe to
   re-run; a Google "edit all" of them isn't possible.]
6. Household twins of feed events (hand-made "Jayden soccer" next to the
   TeamSnap game): link them or leave them? [Link: the hand-made event is
   kept, tagged, and follows the feed's time and place; its title stays.]
7. The "Jayden (hub)" calendar afterwards? [Switched off; you delete it
   in Google when you're happy.]
