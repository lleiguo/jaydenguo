# Intent: Cookie changes the calendar
Status: approved (owner, 2026-10-02, in chat, with the spec and plan).
Drafted by Claude from the owner's request.
The owner chose the household Google Calendar for described events the
same day; the open questions below are answered by the defaults in
spec §6.
Owner: Jayden's parent (lleiguo).

"One thing I want the AI assistant to be able to do is to create
calendar events based on incoming email … either it's explicitly coming
from me, or I can say 'search today's email and update my calendar
accordingly'." And, the same day: "I also want to support something
broader, like 'add dentist appointment for [his brother] for Monday 6pm
Dec 3rd' … it'll update the 'household' calendar and assign owner."

## Problem
The hub already reads emails from allow-listed coaches and clubs and
turns them into suggestions (0001, EML-1..3): a new event, a changed
time, a cancellation. Each waits under More → Suggestions until a
parent opens the page, checks it and approves it. On a busy day that
page isn't opened, and the practice that moved stays wrong on the
calendar. And a family event nobody emailed about (a dentist
appointment, a birthday party) is added by opening the calendar and
filling in a form. Cookie (0007) could do both from one sentence, but
she is read-only by design (0007 CHR-6): asked to add something, she
says she can't.

## Proposed outcome
Cookie can add to the calendar, but only when a parent asks her to.
Three ways to ask:

### 1. An event the parent describes
- "Add a dentist appointment for [his brother] on Thursday December 3rd
  at 6 pm." She adds one event: the title, the day, the time, whose it
  is, and the place if one was said.
- **Whose it is.** The person named becomes the event's owner (one of
  Settings → People, or several: "for both boys"). With no name she
  asks whose it is: in the hub an event with no owner counts as the
  primary person's, which a spoken sentence shouldn't decide silently.
- **She says back what she added,** in one line, with the weekday:
  "Added: dentist, Thursday December 3, 6 pm, for [his brother]", and
  names a clash if it has one.
- **She asks instead of guessing** when something doesn't fit or is
  missing: a weekday that doesn't match the date (in the owner's own
  example, December 3rd 2026 is a Thursday, not a Monday), a name that
  isn't one of the people, no day at all, or a day already past. No
  time given means she asks whether it is all day.
- Defaults she doesn't ask about: one hour long; the category from the
  words when it is one of the hub's (tennis, swimming, soccer, hockey,
  math, Chinese, fitness), otherwise "other", as a dentist appointment
  would be.
- One event per question. No repeating events ("every Tuesday") in this
  intent.

### 2. One email suggestion, named by the parent
- "What came in by email?" She lists the pending suggestions in a
  line each: what, when, and who the email was from.
- "Add the swim meet one." She approves that one suggestion, says what
  she did ("Added: swim meet, Saturday 24th, 8 am, Birch Aquatic
  Centre"), and names a clash if the new event has one.
- If more than one suggestion matches, or none does, she asks which
  and changes nothing.

### 3. Today's email, all at once
- "Search today's email and update my calendar accordingly." She
  looks at the suggestions from emails that arrived today and applies
  the ones she is sure of: new events added, changed events moved,
  cancelled events marked cancelled.
- She then says what she did and what she left, shortly: "Added 2,
  moved 1. One I left for you: the time wasn't clear."
- Left for the parent, never applied by this command: a suggestion
  with a low-confidence field, a change or cancellation whose event
  she can't match, and anything past a small limit per command.
- If today's emails haven't been read yet, she starts the read and says
  so ("I'm checking the mail; ask me again in a minute"), because
  reading and extracting takes longer than one question allows.

### All three ways
- **Undo.** The answer in the chat carries an Undo, as saving a memory
  does: it takes the events back off the calendar and puts any
  suggestions back to pending.
- **Shown, not only said.** The chat lists each event she touched, with
  a link to it, so a mishearing is visible.
- An applied suggestion is an ordinary approved one: source "email", a
  link back to the message, kept in the hub as approved suggestions are
  today. An event she was told to add is an entry in the household
  Google Calendar (below). Both are recorded as made through Cookie, by
  which parent.

### Where a described event is written
**Decided (owner, 2026-10-02): B, the household Google Calendar
itself.** That is the family's own Google Calendar, which the hub today
only reads, on purpose: the hub's Google permission can't write to it
"even by mistake" (0001 GCO-1), which also rules out sync loops. So
this intent changes that rule: the hub gains permission to add events
to the household calendar, used only by this command. The two ways
that were weighed:

- **A. In the hub (not chosen).** The event is added in the
  hub, as the calendar's "+" does today, with its owner. It shows on
  every hub screen at once, and reaches Google Calendar through the
  hub's own copy calendar ("Jayden (hub)") when that is switched on. No
  new Google permission; Undo is exact; the owner is a real field.
- **B. In the household Google Calendar itself (chosen).** Everyone who shares
  that calendar sees it there directly. It needs a new Google
  permission to write events to that calendar (the owner signs in to
  Google again and agrees), and the event then comes back into the hub
  on the next read. Google events have no "owner" field: whose it is
  would be carried by putting the name in the title ("[Brother]
  dentist"), which the hub's existing rules already turn into an owner.
  More to build (writing, not showing it twice, Undo across two
  systems) and it undoes a deliberate safeguard.

What B asks of the spec:
- The narrowest Google permission that can add an event to that one
  calendar, and code that only ever adds, and removes only what Cookie
  herself added (for Undo). It never edits or deletes the family's own
  entries.
- The event shows in the hub at once, not only after the next read of
  Google, and shows once when that read brings it back.
- The hub's copy calendar (GCO-1) must not copy it out again as a
  second Google event.
- If Google refuses or is unreachable, she says the event wasn't added;
  she doesn't keep a hub-only event that the family calendar lacks.
- The owner signs in to Google again to grant the permission (a step
  for the owner in the plan).

## What this is not
- **Not on her own.** Nothing from email reaches the calendar without a
  parent asking in that question. No background "auto-approve".
- **Not editing by voice.** She adds. Moving, renaming or deleting an
  existing event ("move practice to 5") stays on the calendar screen,
  apart from the moves and cancellations an email suggestion carries.
- **Not a wider reading of the mailbox.** She works from the same
  allow-listed senders and labels as today (EML-1). "Today's email"
  means today's email from those senders, not the whole inbox.
- She does not reject suggestions, edit their fields, or change any
  other hub data. Correcting a field before approving stays on the
  Suggestions page.

## Affected users and systems
- Users: the two allow-listed parents. A child holding the phone could
  ask too, which is why she only applies what an allow-listed email
  already proposed and everything can be undone.
- Cookie's backend (0007): four new tools (add an event, list
  suggestions, apply one, apply today's), her prompt, the server-side
  rules below, eval cases. Spec 0007 CHR-6 ("read-only") gains this one exception.
- Email suggestions (0001 M5.8): the approve path is reused as it is;
  it needs an "un-approve" for Undo.
- Calendar (0001): a new Google permission and a small writer for the
  household calendar; 0001 GCO-1 ("never writes to the household
  calendar") gains this exception; the reader and the copy learn to
  recognise an event Cookie added.
- iPhone app: the Undo and the list of touched events under her answer.

## Constraints
- **The parent's own words start it.** As with saving a memory (0007
  MEM-1), the server checks that the question itself asks for the
  calendar to be changed. Text inside an email, an event or a web page
  can never start it (0007 CSEC-6). This matters more here than
  anywhere else in Cookie: an email is text written by someone outside
  the family.
- No calendar change in a question that also used the web.
- One described event or one named suggestion per question; a small
  fixed limit per command for today's email.
- **Mishearing.** The transcript test (0007 SP-C1) heard one child's
  name as the other's in one clip of twenty; for a lookup that is a
  wrong answer, here it would be an event for the wrong child. So the
  read-back names the person and the weekday, the chat shows the event,
  Undo is one tap, and a spoken suggestion is applied only when the
  transcript matches exactly one.
- The date and time are worked out by the server from what the model
  understood ("Thursday", "December 3rd", "6 pm"), in the home time
  zone, and checked against each other; the model doesn't do the
  calendar arithmetic unchecked.
- Raw email is still never stored, and Cookie is not given email
  bodies: she sees the extracted fields and the short quote the
  Suggestions page shows.
- Keeps 0007's limits: tool calls per question, the monthly cap, logs
  with no words.

## Things to check first (before a spec)
Checked 2026-10-02; the answers are in [spec.md](spec.md) §2. In short:
no Gmail source is connected in production, extraction can't run on
Claude today, and the web service can't use a Google grant, so the
worker does the writing.

1. **Is email reading working in production at all?** Suggestions are
   extracted by Claude on Vertex AI, and the project's Claude quota was
   still 0 when last checked. If so, no suggestions exist to act on, and
   the first job is to move the extraction to the Gemini Flash model
   Cookie already uses.
2. **How fresh is "today's email"?** Email is read once a day with the
   other sources, and on demand at most once an hour per source. "Search
   today's email" needs the read to have happened recently; the spec
   decides between a more frequent scheduled read and a read started by
   the question.

## Assumptions (defaults until the owner says otherwise)
- App only, typed or spoken, like the rest of Cookie.
- "Today" is today in the home time zone, by when the email arrived.
- The batch command applies at most 5 suggestions and leaves the rest
  pending.
- Only suggestions whose fields are all high or medium confidence are
  applied by the batch command; a named single suggestion is applied
  whatever its confidence, because the parent picked it, and she says
  which field was unsure.
- A new event that clashes with another is still added, and she names
  the clash, as the Suggestions page does.
- Undo is offered for 10 minutes in the chat; after that the event is
  changed on the calendar like any other.

## Open questions
0. A or B: where does a described event go? **Answered 2026-10-02: B.**
   Follow-up for the spec: should email suggestions applied by Cookie
   go to the household calendar too, or stay hub events as approved
   suggestions are today? (Default: stay as today.)
1. Should the batch command also apply changes and cancellations, or
   only add new events and leave moves and cancellations for the page?
   (Default above: all three.)
2. Should she ask "Add these 3?" and wait for a yes before a batch,
   instead of applying and offering Undo? Safer, but it is two turns by
   voice instead of one.
3. Should she tell you unprompted that suggestions are waiting, for
   example when asked "what's on today?"
4. Should emails be read more often than once a day so "today's email"
   is usually already there?
5. Does the other parent get the same commands, or the owner only?
6. No person named: ask (default), or give it to everyone in People?
7. Should repeating events ("every Tuesday at 5") come next?

## Size
After 0007's K7, in working days:
- Email suggestions (ways 2 and 3): 3–4, if email reading already works
  in production. Moving the extraction to Gemini, if needed: about 1
  more.
- Described events (way 1), written to the household Google Calendar:
  about 6: the tool and the date rules 1.5, the Google permission and
  writer 1.5, showing it once and keeping the copy calendar out of it
  1, Undo and the app 1, tests and eval cases 1. Plus the owner's new
  Google sign-in.

Described events don't depend on email, so they can be built first.
