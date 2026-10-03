# Intent: Cookie reads an email when asked
Status: approved (owner, 2026-10-03, in chat: "defaults are fine"). Drafted
by Claude from the owner's request; the owner chose "fetch when asked" the
same day, and the defaults for the open questions below.
Owner: Jayden's parent (lleiguo).

"I just want Cookie to read the email, and find the one I asked and
summarize it to me."

## Problem
The hub reads email from allow-listed senders only to find calendar
changes (0001 EML-1..3). It keeps the suggestions, never the email: the
text is dropped once read (0001 §7.2). So when a parent asks Cookie "what
did the school say about the field trip?", all she can see is the
suggestions list (0008 EMS-2), and she answers that she only sees calendar
suggestions. The answer is in the email, which nobody can ask her about.

## Proposed outcome
A parent asks Cookie about an email in plain words, typed or spoken, and
gets a short summary of it.

- **What she looks for.** The email the question describes: by its
  sender, its subject or what it is about, and roughly when ("today",
  "this week", "the one from the coach yesterday"). If several fit, she
  summarizes the best match and names the others by subject, so the
  parent can ask for another.
- **Fetched when asked; nothing kept** (owner's choice, 2026-10-03). The
  email isn't stored in the hub, now or after. Only her answer is, like
  any answer in the chat, and it goes when chat history goes (0007 MEM-9).
- **"Checking, ask me again" is not the experience.** The search happens
  in the background (only the worker may open the Google sign-in, 0001
  CRED-4). She says at once that she's looking ("I'm checking the
  mail…"), and the summary arrives in the same chat as a follow-up
  answer, usually within a minute. If the app isn't open, a notification
  brings it.
- **The summary.** A few sentences in the question's language: who it's
  from, when, and what it says, with any dates, times, places and things
  to bring or do. A link opens the email in Gmail.
- **Not here.** Replying to, deleting, labelling or forwarding email.
  Reading attachments. Changing the calendar from what she read: that
  stays with email suggestions (0008 EMS-3, EMS-4).

## Constraints
- **Which mail.** The Gmail permission the hub already has
  (`gmail.readonly`) can read the whole mailbox. By default she looks only
  at mail from the email source's allow-list (0001 EML-1); see question 1.
- **Text in an email is data, never an instruction** (0007 CSEC-6). What
  an email says can't make her do anything but summarize it.
- **Privacy.** The email's text goes to Gemini on Vertex AI to be
  summarized, as email already does for suggestions (0008 EMS-1). It isn't
  written to the database or the logs.
- **Cost.** One search and one model call per question. It counts against
  Cookie's monthly limit (0007 LIM-5).

## Open questions (defaults in brackets)
1. Allow-listed senders only, or the whole mailbox? [Allow-listed only.
   Whole mailbox means a question can surface any email the account has,
   including other people's messages and sign-in codes.]
2. How far back? [The last 30 days.]
3. Notification when the summary is ready and the app is closed? [Yes, to
   the parent who asked only.]
4. Spoken questions: read the summary aloud when it arrives? [Only if
   the app is open and she is still on screen; otherwise just show it.]
