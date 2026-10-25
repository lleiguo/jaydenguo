# Intent: Today's mail, summarized and read aloud
Status: approved (owner, 2026-10-25, in chat: "approve, defaults"); defaults kept. Drafted by Claude from the owner's request.
Owner: Jayden's parent (lleiguo).

"can I also turn family hub into a reading app, e.g. it reads certain
email and summarize it and read it in the app? give me some ideas"

Then, of the ideas Claude offered: "start with 1-6, yes, draft an intent,
spec, plan as a doc PR so I can review and approve". The six:

1. A morning mail digest, read aloud, with a notification.
2. A Gmail label ("Hub/Read") that decides which mail it reads.
3. Action items, not just summaries.
4. Grouped by child and activity.
5. Long newsletters condensed to what matters to us.
6. Listen mode: "Cookie, read me today's mail."

## Problem
The hub reads email in two ways today, and neither is reading:

- **Suggestions** (0001 EML-1..3, 0008). The email source fetches
  allow-listed mail and keeps only calendar changes found in it. An email
  with no date ("the library books are due back", "please send a water
  bottle", a school newsletter) leaves nothing behind.
- **Cookie on request** (0009). She finds one email you ask about and
  summarizes it. You have to know the email exists and ask for it.

So the school's and the clubs' mail still has to be opened, read and
remembered one email at a time. Forms, money and things to bring are
easy to miss. A long newsletter usually holds two or three lines that
matter to this family.

## Proposed outcome
Each morning the hub has read the day's mail from the senders you chose,
and can tell you what it said in about a minute.

- **Today's mail.** A card at the top of Today: "4 emails, 2 things to
  do". Tapping it opens the Mail screen, where each email has a summary
  of a few sentences: who it's from, when, what it says. A link opens the
  email in Gmail.
- **You choose the mail.** It reads what the email source's allow-list
  already allows (0001 EML-1), plus anything you label `Hub/Read` in
  Gmail. Labelling by hand or with a Gmail filter is how a new sender
  gets added without opening Settings.
- **Things to do.** Each summary ends with what you need to do and by
  when: sign the form by Friday, bring $5, pick-up moves to 3:15. Those
  without a calendar date are a checklist you tick off. Those that are
  calendar changes point to the suggestion the hub already makes from
  the same email (0008), so nothing is added twice.
- **Grouped the way the hub is.** Emails are grouped by person (Jayden,
  his brother, the family) and by topic (School, Tennis, Swimming,
  Soccer, other activities, Household), not listed like an inbox.
- **Newsletters condensed.** A long newsletter becomes the few things
  that matter to this family (his grade, his teams, the next two weeks on
  the calendar), with "the rest" folded away.
- **Read aloud.** One button plays the whole digest in Cookie's voice,
  English and Mandarin as written. A notification at 6:30 says it's
  ready.
- **Listen mode.** "Cookie, read me today's mail." She reads the
  summaries one at a time. "Next", "tell me more" (she reads that email
  again in full detail, as 0009 does) and "add that to the calendar" (she
  applies its suggestion, as 0008 does).
- **Not here.** A weekly recap (idea 7, later). Replying, forwarding,
  archiving or labelling mail from the hub. Reading attachments. Mail
  outside the allow-list and the label. The website (the Mail screen is
  iPhone only at first; see question 5).

## Constraints
- **A summary is kept now.** 0009 chose "fetch when asked; nothing kept".
  A morning digest only works if the hub keeps what it read, so this
  intent stores each email's summary and its to-dos for 14 days. The
  email's own text is still never stored (0001 §7.2): it's read,
  summarized and dropped in the same worker run.
- **Text in an email is data, never an instruction** (0007 CSEC-6, 0009
  ERSEC-2). The summarizer has no tools; an email can't make the hub do
  anything.
- **Only the worker opens the Gmail sign-in** (0001 CRED-4). The digest
  is built by a scheduled worker job, not when the app opens.
- **Privacy.** The email's text goes to Gemini on Vertex AI, as for
  suggestions (0008 EMS-1) and Cookie's reading (0009). So do the people's
  names, his grade and teams, and the next two weeks' event titles, to
  condense newsletters.
- **Cost.** About one Flash call per email (around US$0.001–0.003) and a
  spoken digest when played. It counts against Cookie's monthly cap (0007
  LIM-5), with its own line on the Costs page.
- **Infrastructure.** A new morning schedule is a Terraform change: the
  owner applies it.

## Open questions (defaults in brackets)
1. Which mail? [The email source's allow-list plus the `Hub/Read` label.
   Label only is quieter; the allow-list includes automated mail
   (TeamSnap, club notices) that the digest folds under "Also came in".]
2. How long are summaries kept? [14 days; to-dos until ticked or 30
   days. "Clear history" in Settings removes them too.]
3. When is it ready, and does it notify? [Built at 6:30 home time, with a
   notification then; the time is a setting. More mail during the day is
   added at the next daily sync and on pull to refresh, with no second
   notification.]
4. Who gets it? [Both parents; the digest is shared, the notification is
   a per-phone switch (kind `mail`), on by default in the new build.]
5. Website too? [iPhone first. A plain web page can come later.]
6. Read aloud by the server voice or the phone's voice? [The server
   voice, as Cookie does (0007 VOX-5), falling back to the phone's at 80%
   of the cap.]
