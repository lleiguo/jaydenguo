# Intent: A push for each step of his tennis and swimming, every suggestion and every clash
Status: approved (owner, 2026-10-19, in chat: "approve, defaults"); defaults kept. Drafted by Claude from the owner's request.
Owner: Jayden's parent (lleiguo).

"next feature to add: push notification, I would like to receive
notification when:
1. tennis: when tournament is open for registeration, Jayden registered,
accepted to a tournament or tournament draw is out, when result is posted
2. swimming: swim meet is registered, heat sheet is out, result is posted
etc.
3. Suggestions: any event suggestions come up
4. Any event clash, notify me to resolve conflict, and easy way to
directly navigate to clash"

## Problem
The iPhone app already has push notifications (0004 PUSH-1..6): a clash
in the next 14 days, a draw out and his next opponent, a tournament to
enter or pay, accepted or off the entry list (0017 ACC-6), new email
suggestions, video reviews, failing sources and Cookie's answers. But:

- **Nothing arrives today.** The APNs key was never set up in production
  (0004 plan O-3). The worker's log on 2026-10-19 still says "push not
  sent (no APNs key)" for every notification. This is the first thing to
  fix, and it's the owner's step.
- **Tennis gaps.** No push when he's registered (entered), and none when a
  match result is posted.
- **Swimming has none.** Commit Swimming already syncs meets, his entries
  and his results (0001 SWM-2, SWM-3), but nothing notifies.
- **Suggestions are off by default** (the owner's answer to 0004's
  question 3), so they're off on the phone unless switched on.
- **A clash push opens one event**, not the clash: from there the parent
  has to find the other event to decide which one gives way. A clash
  notifies once; if it's still open close to the day, nothing reminds.

## Proposed outcome
- **Pushes arrive.** With the APNs key in place, every kind that exists
  today reaches the phone.
- **Tennis, each step.** Open to enter (already, as "Tournament to
  enter"), registered, accepted, draw out and next opponent (already),
  and each match result ("Won 6-3 6-4 against X, R16").
- **Swimming, each step.** Entered in a meet (with his events), heat
  sheet out (heat and lane for each event, if Commit Swimming shows
  them; spike first), results posted (one push per meet day, with times
  and best times).
- **Every suggestion.** The new app build switches suggestions on once
  for phones that never chose; new kinds are on by default.
- **Clash, straight to the decision.** Tapping a clash push opens a clash
  screen: both events side by side, with Accept, Skip this one (either
  side) and open either event. A clash still open 2 days before it
  starts pushes once more.
- **Not here:** email or SMS, pushes to the web browser, notifications
  for other children, quiet hours (iOS Focus already does that).

## Constraints
- PUSH-2 stays: Apple only sees "Hub: new update"; the text is fetched by
  the app's extension.
- Installed app builds must keep working: new kinds are never sent in the
  list old builds decode (the 0009 rule, `OPT_IN_KINDS`).
- One push per event (PUSH-5): a result corrected later doesn't notify
  again; a meet's results come as one push per day, not one per swim.
- Polite to Tennis Canada and Commit Swimming (SYNC-5): no extra reads;
  everything here is noticed by syncs that already run.

## Open questions (defaults in brackets)
1. Tennis results: one push per match, or one per tournament day? [Per
   match: there are one or two a day, and each one changes what's next.]
2. Clash reminder: when? [Once, 2 days before the first event starts, if
   the clash is still open (not accepted, neither side skipped).]
3. Swimming "registered": when his entries appear, or when the meet
   sign-up says yes? [When his entries appear: that's when he's really
   in, and the push can list his events.]
4. Heat sheet: if Commit Swimming doesn't show heats and lanes before
   the meet, skip it? [Yes; say so in the plan's Status. Reading heat
   sheet PDFs from email would be its own intent.]
