# Intent: His tests and homework from Google Classroom
Status: draft (2026-10-12). Drafted by Claude from the owner's request.
Owner: Jayden's parent (lleiguo).

"use browser tool to examine https://classroom.google.com/u/5/h/st, and
suggest what would be integrated into family hub app (this is [his
brother]'s classroom)" — then, on the suggestions: "yes, go ahead".

## Problem
- His brother's (Grade 11) teachers put tests, quizzes and homework in
  Google Classroom. The hub shows his Veracross timetable and the school's
  key dates (0001 SCH-1, SCH-2), but no tests and no homework.
- 0001 already planned Classroom (SRC-8, SCH-3, SCH-4) for Jayden. The
  connect button and its check were built (M4.1), but the access spike
  (SP-5) never ran and M4.3 was deferred (owner, 2026-09-28).
- What his Classroom looked like on 2026-10-12, read in the browser:
  - **Physics posts its tests as assignments.** Each is a
    "⏰REMINDER: <day> – FEAST on …" (a unit test) or "– Appetizer on …"
    (a quiz) with the test day as its due date. Nothing is handed in.
  - **So "Missing" says 21, but almost all are past test reminders.**
    Only two look like real work not handed in: a Life Sciences game from
    Sept 22 and a house form with no due date.
  - The rest is noise for a parent: weekly teacher notes, photos of class
    notes, Gemini notebooks, Drive folders, clubs, a 2025 club meeting,
    8 hidden classes.

## Proposed outcome
- **Tests and quizzes on the calendar.** A Classroom item whose title says
  it's a test or quiz shows as an all-day "Test" or "Quiz" on his day,
  e.g. "Test · Physics 11: Forces, including Newton's Laws".
- **Homework due this week**, on his "Today at school" card (web and
  iPhone), soonest first, with the class and the day. Items with no due
  date show until handed in. Test reminders aren't homework.
- **Missing means missing.** Only real work past its due date and not
  handed in, from this term. Today that's one item, not 21.
- **Cookie knows.** "What's due for him this week?", "When's his next
  physics test?", "Is anything missing?"
- **Every item links back to Classroom** (0001 SCH-5).
- **Not here.** Grades and their trend (0001 SCH-4); announcements,
  class-note photos, notebooks, Drive files; anything written back to
  Classroom; Jayden's Classroom (he can be added later the same way).

## Constraints
- Read-only, his own coursework only: the two scopes the connect button
  already asks for (`classroom.courses.readonly`,
  `classroom.coursework.me.readonly`).
- No scraping Classroom pages, and his school password is never stored
  or typed by an agent: he or the owner consents on Google's page.
- His school's Google admin may block the app (0001 F-5). If so, a
  fallback from §Open questions 1.
- No names of the boys, teachers, classmates or the school in the repo;
  fixtures scrubbed (0010).
- No new LLM calls: tests are told apart by words in the title.

## Open questions (defaults in brackets)
1. If the school blocks Classroom, what then? [Spike two fallbacks and
   pick with the owner: Veracross "Upcoming Assignments" (the hub already
   signs in there), then Classroom's guardian email summaries read through
   Gmail. Asking the school's IT to trust the app is the owner's call.]
2. Which words mark a test or quiz? [Set on the Classroom source, like
   title rules. Starts with "test", "exam", "quiz", "feast" (test) and
   "appetizer" (quiz); the owner can edit them.]
3. Which classes count? [All his active classes, with a switch per class
   on the source to leave one out (clubs, house, grad resources).]
4. How far back does "missing" look? [30 days: older items are taken as
   settled. The 2025 club item and last month's reminders drop off.]
5. Grades? [Not now: no one asked, and they need care to show well.
   A later intent.]
