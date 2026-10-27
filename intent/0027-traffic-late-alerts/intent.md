# Intent: Tell me when to leave, and when I'm running late, from live traffic
Status: draft (2026-10-27). Drafted by Claude from the owner's request.
Owner: Jayden's parent (lleiguo).

"can we add a feature to notify me if I'm late for next event due to real-time traffic?"

## Problem
The calendar knows where the next event is (the event's location, or a
saved place from CON-1) and when it starts, but nothing tells a parent
when to set off. Travel time today is only a fixed buffer between saved
places (0001 CON-1, `location_buffers`), used for clashes, not for
leaving. Traffic around a weekday 4 pm practice can double the drive, and
we find out in the car.

## Proposed outcome
- **Leave-by push.** About 10 minutes before you need to leave for your
  next event, the iPhone gets "Leave by 3:42 for Tennis at <place>:
  28 min with traffic".
- **Running-late push.** If the leave-by time passes and you're still
  where you were (not moving towards the event), one more push: "Leave
  now: you'll get to Tennis at 4:07, 7 min late".
- **Real traffic, from where you are.** Drive time comes from a live
  traffic route between your phone's last known place (or home, if the
  phone hasn't shared one) and the event's address.
- **Only events you go to.** Today's timed events with a place, for the
  people you choose in Settings (default: all events on the family
  calendar where attendance is required), not all-day events or school
  periods.
- **One switch.** A notification kind "Time to leave" in Settings →
  Notifications, off until you turn it on on that phone.
- **Not here:** turn-by-turn directions (the push opens the event, which
  links to Apple Maps), walking or transit, telling the coach you're late,
  Android or the web.

## Constraints
- Location is personal data: the server keeps only each phone's latest
  place, overwrites it, forgets it after 24 hours, never logs it, never
  puts it in a push (PUSH-2: payloads carry ids only).
- The app asks for location only when the parent turns this on; "While
  using" still works (home is the fallback), "Always" makes running-late
  accurate.
- Cost stays near zero: a traffic route is asked for only for events in
  the next 2 hours, at most every 10 minutes per event, within the maps
  provider's free monthly tier.
- 0004 push rules, 0023 kinds rules (`OPT_IN_KINDS`, `more`) hold.

## Open questions (defaults in brackets)
1. Whose events? [Events where attendance is required, any person; you
   can narrow it to some people in Settings.]
2. How early is the leave-by push? [10 minutes before leave-by; leave-by
   includes 5 minutes to park and walk in.]
3. Where from, if the phone hasn't shared a place? [Home: the address of
   a saved place you mark as home.]
4. Which traffic source? [Google Routes API with traffic, from the GCP
   project we already have; Apple's on-phone ETA can't run reliably in
   the background.]
5. Both parents? [Each parent's phone gets its own pushes, from its own
   place, if that phone turned the kind on.]
