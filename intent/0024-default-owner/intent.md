# Intent: An event belongs to whoever it names, else whoever made it
Status: draft (2026-10-24). Drafted by Claude from the owner's request.
Owner: Jayden's parent (lleiguo).

"for any event created, don't default to everyone, if it has an owner like
"jayden tennis", then assign Jayden as owner, if there's no clear owner on
the event itself, use the creator as the owner e.g. if it's created by
[the other parent] then assign to [the other parent]"

(The parent's name is left out here, as for other family names in these
docs.)

## Problem
Whose an event is comes from `ownersFor` (0001 CON-1, PR #54): a
source's title rules, then any person named in the title, then the
source's **default owners**, then the primary person (Jayden). Nothing
looks at who made the event.

So an event someone adds to the family's Google Calendar without a name
in the title ("Dentist", "Parent–teacher night") gets the household
source's default owners, which is the whole family. It then shows as
everyone's, clashes for everyone (CON-1), and fills every person's
filter. On the calendar screen a new event is ticked for Jayden whoever
adds it (`resolveOwners`), and Cookie asks "whose is it?" when nobody is
named (0008 ADD-3).

## Proposed outcome
- **A name wins.** If the event names someone ("Jayden tennis", "Lei's
  dentist") or a title rule matches, it is theirs, as today.
- **Else the person who made it.** No name: it belongs to whoever
  created it.
  - The family's Google Calendar: Google's creator of the event, matched
    to a person by their Google email.
  - The calendar screen (website and iPhone app): the signed-in parent
    is ticked instead of Jayden.
  - Cookie: the parent who asked, said back in "Adding: …, for [name]".
  - Email suggestions: the parent whose mailbox it came from.
- **Everyone only when said.** An event is everyone's only when a parent
  ticks everyone, tells Cookie "everyone", or the title says "family" or
  "everyone". The household source's default owners no longer give
  everyone an event.
- **People know their emails.** Settings → People gets a Google email
  for each person who makes events, so the hub can tell who made one.
- **A parent's change still wins.** Changing whose an event is keeps
  working and survives sync (CON-5), as today.
- **Not here:** school, tennis, swim, Spordle and other feeds, which
  have no creator (their title rules and default owners stay, so
  Jayden's tennis is still Jayden's); changing events already made in
  the hub or by Cookie.

## Constraints
- Emails are personal data: they live in the database only, never in
  the repo; fixtures use `example.com`.
- Schema change: a new column on `people` (generated migration).
- The hub's own writes to Google (0008 GCW, 0020 TWO) are skipped on read
  or kept by their override, so they keep the hub's owners.
- Website and iPhone app both change, so a TestFlight build follows.

## Open questions (defaults in brackets)
1. When Google's creator matches nobody in People, who owns it? [The
   source's default owners, then Jayden: today's rule.]
2. Should Cookie stop asking "whose is it?" when nobody is named? [Yes:
   it's the asker's, and she says so in the read-back. From a screenshot
   or pasted text (0019 SHA-3) too, when the material names nobody.]
3. Should existing household events with no name move from everyone to
   their creator? [Yes: the household sync works out owners on every
   run, so upcoming ones move at the next sync. Ones a parent already
   changed stay as they are.]
4. Do "family" and "everyone" in a title mean everyone? [Yes, as whole
   words, so a family dinner can still be everyone's.]
