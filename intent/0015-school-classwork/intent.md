# Intent: His tests and homework from Google Classroom
Status: draft (2026-10-12). Drafted by Claude from the owner's request.
Owner: Jayden's parent (lleiguo).

"use browser tool to examine https://classroom.google.com/u/5/h/st, and
suggest what would be integrated into family hub app (this is [his
brother]'s classroom)" — then, on the suggestions: "yes, go ahead".

After the school blocked the app (plan SP-C1): "I still want to go down
the server login route, the creds are stored secretly, only read/used
when needed, never stored on server directly, and I'm the own[er] of the
app including source code, infra, everything so I don't see the risk is
that big".

## Problem
- His brother's (Grade 11) teachers put tests, quizzes and homework in
  Google Classroom. The hub shows his Veracross timetable and the school's
  key dates (0001 SCH-1, SCH-2), but no tests and no homework.
- 0001 planned Classroom through its API (SRC-8, SCH-3, SCH-4; M4.3
  deferred). On 2026-10-12 his school blocked that: "Access blocked: Your
  institution's admin needs to review jaydenguo.com" (plan SP-C1).
  Veracross doesn't have his Classroom work, no guardian summaries reach
  the owner, and the class calendars have no iCal address (SP-C2).
- What his Classroom looked like on 2026-10-12, read in the browser:
  - **Physics posts its tests as assignments.** Each is a
    "⏰REMINDER: <day> – FEAST on …" (a unit test) or "– Appetizer on …"
    (a quiz) with the test day as its due date. Nothing is handed in.
  - **So "Missing" says 21, but almost all are past test reminders.**
    Only two look like real work not handed in.
  - The rest is noise for a parent: weekly teacher notes, photos of class
    notes, Gemini notebooks, Drive folders, clubs, 8 hidden classes.

## Proposed outcome
- **Tests and quizzes on the calendar.** A Classroom item whose title says
  it's a test or quiz shows as an all-day "Test" or "Quiz" on his day,
  e.g. "Test · Physics 11: Forces, including Newton's Laws".
- **Homework due this week**, on his "Today at school" card (web and
  iPhone), soonest first. Test reminders aren't homework.
- **Missing means missing.** Only real work past its due date and not
  handed in, from this term.
- **Cookie knows.** "What's due for him this week?", "When's his next
  physics test?", "Is anything missing?"
- **Every item links back to Classroom** (0001 SCH-5).
- **Not here.** Grades (0001 SCH-4); announcements, notes, notebooks,
  Drive files; anything written back to Classroom.

## How the hub reads it (owner's decision, 2026-10-12)
The hub signs in to Classroom as him from the worker, with his school
Google login kept in the credential vault (0001 CRED-1..6, as Veracross
and Tennis Canada are), and reads his pages. The owner accepts that this
goes around the school's app review and is his own decision as the
parent and the app's owner.

## Constraints
- **No getting past Google's checks.** A plain browser that names the app
  in its user agent (0001 SYNC-5); no stealth plugins, CAPTCHA solving or
  faked devices. When Google asks for anything but the password (a code,
  a phone prompt, "this browser may not be secure", a CAPTCHA), the sync
  stops and the Accounts page says what Google asked. A code can be typed
  by a person on the Accounts page, as Veracross codes are.
- **The password goes in once per sign-in**, never retried in a loop; a
  refusal stops the source until the owner presses Test connection.
- **The session is kept encrypted** so the job signs in rarely, and it
  reads at most once a day plus on demand.
- **Read only.** The job opens his To-do and class pages, nothing else in
  his account (no Gmail, Drive, Calendar settings), and never clicks
  anything that hands in, comments or changes a setting.
- **No agent types the password.** The owner enters it on the Accounts
  page.
- No names of the boys, teachers, classmates or the school in the repo;
  fixtures scrubbed (0010).

## Open questions (defaults in brackets)
1. Which words mark a test or quiz? [Set on the source. Starts with
   "test", "exam", "feast" (test) and "quiz", "appetizer" (quiz).]
2. Which classes count? [All, with a switch per class on the source.]
3. How far back does "missing" look? [30 days.]
4. Still ask the school's IT to approve the app? [Yes: if they do, the
   source can move to the API (0001 M4.1) and the stored password can
   go.]
5. Grades? [Not now.]
