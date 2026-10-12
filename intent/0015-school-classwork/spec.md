# Spec: His tests and homework from Google Classroom
Status: draft (2026-10-12). Written by Claude from [intent.md](intent.md).

Read with 0001 (SRC-8, SCH-1, SCH-3, SCH-4, SCH-5, CRED-2, F-5, F-6,
spikes.md SP-5), 0004 (the iPhone Today screen) and 0007 (Cookie's tools,
TOOL-5 school). IDs here: CW (classwork), CWSEC (security).

## 1. What changes in earlier specs
- **0001 SRC-8** Becomes real: a `classroom` source with one owner (a
  child), fed by the Google credential "Connect school account
  (Classroom)" already creates. Same two scopes.
- **0001 SCH-3** Replaced by CW-3..CW-6: test reminders aren't homework,
  and "missing" is limited (CW-5).
- **0001 SCH-4** Grades stay deferred.
- **0001 SCH-1** The "Today at school" card gains a homework list (CW-4).
- **0001 SCH-5** Stays: every item links to its Classroom page.
- **0007 TOOL-5** The school tool also answers homework, tests and
  missing work (CW-7).
- **0001 M4.3** Is built by this intent (CW1..CW3), for whichever child
  the source belongs to.

## 2. Requirements

### 2.1 Reading Classroom (CW)
| ID | Requirement | Acceptance criteria |
|---|---|---|
| CW-1 | A Classroom source per child. | Settings → Accounts: a "Google Classroom" source takes a connected Classroom credential and one owner from People. Its sync reads his active courses, then each course's coursework and his submission for each (`courses.courseWork.list`, `studentSubmissions.list` with `userId=me`). Runs daily at 06:00 and on demand (Refresh), like other API sources (0001 SYNC-5: no hourly limit for APIs). |
| CW-2 | Classes can be left out. | The source lists his courses by name with a switch each, all on by default; a class switched off isn't read again and its items are removed from view. Archived courses are never read. |
| CW-3 | Tests are told apart. | A coursework item whose title contains one of the source's **test words** (case-insensitive, whole word) is a test; one with a **quiz word** is a quiz. Defaults: test = "test", "exam", "feast"; quiz = "quiz", "appetizer". The owner can edit both lists on the source. A test or quiz is never homework and never missing. |

### 2.2 What's shown (CW)
| ID | Requirement | Acceptance criteria |
|---|---|---|
| CW-4 | Tests and quizzes on the calendar. | Each is an all-day event of the Classroom source on its due date (local), owned by the source's owner, category "school class", titled "Test · <course>: <topic>" or "Quiz · <course>: <topic>", where topic is the title without the reminder prefix ("⏰REMINDER:", the day and date). No due date: the first date in the title, else not shown. It's in the all-day row, not inside the collapsed School block, and never clashes (all-day). A test whose item is deleted in Classroom disappears at the next sync. |
| CW-5 | Homework on the Today card. | "Today at school" for that child gains "Homework": items not handed in (`state` not `TURNED_IN`/`RETURNED`) that are due from today to 7 days ahead, then items with no due date posted in the last 30 days. Each row: title, course, "today", "tomorrow" or the weekday, and the time if not 23:59. Due today or tomorrow is highlighted. Up to 8 rows, then "and N more". The same list is in the iPhone Today screen. |
| CW-6 | Missing is real. | "Missing" (red, above homework): items that aren't tests or quizzes, are not handed in, and were due in the last 30 days, or Classroom marks late and not handed in. On 2026-10-12's data that's one item, not 21. |
| CW-7 | Links. | Every row and test event opens the item's `alternateLink` in Classroom (0001 SCH-5). |
| CW-8 | Cookie answers. | The school tool (0007 TOOL-5) gains `classwork`: per child, tests and quizzes in the next 30 days, homework due in the next 7 days, missing items. "When's his next physics test?" names the day and topic. |

### 2.3 Errors (CW)
| ID | Requirement | Acceptance criteria |
|---|---|---|
| CW-9 | Blocked or revoked access says so. | If Classroom refuses (403, `admin_policy_enforced`, a revoked grant), the source shows Google's reason word for word (as SP-5 records it) and the last good data stays, marked "last updated <time>". |

### 2.4 Security (CWSEC)
| ID | Requirement | Acceptance criteria |
|---|---|---|
| CWSEC-1 | Only his own coursework, read-only. | Scopes stay the two in `CLASSROOM_SCOPES`; no roster, no classmates, no teacher emails stored. Stored per item: course name, title, due date, state, kind (homework, test, quiz), link, Classroom ids. Not the description, attachments or comments. |
| CWSEC-2 | Nothing personal in the repo. | Fixtures use made-up courses and titles; the denylist check passes. |

## 3. Design
- **Data:** a new table `school_work` (id, source_id, course_id,
  course_name, work_id, title, kind `homework|test|quiz`, due_at, due_all_day,
  state, late, link, posted_at, updated_at), unique on (source_id,
  work_id). Test and quiz rows also upsert an `events` row of the source
  (CW-4), keyed by the work id, so the calendar, clash and copy code needs
  no change. Edit `db/schema/`, then `pnpm db:generate --name school_work`.
- **Source settings** (`source.settings` JSON): `courses: {id, name,
  on}[]`, `testWords`, `quizWords`.
- **Adapter:** `src/adapters/classroom/` gains `listCourses`,
  `listCoursework` and `listMySubmissions` (paged, `politeFetch`), and a
  pure `classify(title, words)` plus `topicOf(title)` in `src/domain/`.
- **Sync:** `sync:classroom` job in the worker, like the other sources:
  read, classify, upsert, remove rows for work no longer listed or for
  classes switched off.
- **Read side:** `loadSchoolDays` adds `homework` and `missing` per child;
  `GET /api/v1/today` and `openapi.json` gain them; the web card
  (`src/components/today/…`) and HubKit `TodayScreen` show them.
- **Cookie:** the school tool's output gains `classwork` (CW-8).

## 4. Testing
- Unit: `classify` and `topicOf` on scrubbed titles shaped like the real
  ones ("⏰REMINDER: Wednesday, Oct. 14 - Feast on Forces …" → test,
  "Forces"); homework, missing and 30-day windows; time zone at the day
  edge.
- Integration: the sync against a fake Classroom (the e2e fake Google
  already serves a sliver of it) writes rows and test events, removes a
  deleted item, keeps data on a 403.
- e2e: the Today card shows homework and missing; a test appears in the
  calendar's all-day row and links out.
- iPhone: HubKit decoding and view tests with a re-recorded fixture.
- Eval: Cookie answers the three questions in the intent from a fixture.

## 5. Concerns for the owner
| # | Concern | Recommendation |
|---|---|---|
| CW-A | His school may block the app (0001 F-5). | Run SP-C1 first (two minutes, the button exists). If blocked, SP-C2 picks a fallback with you before any build. |
| CW-B | Test words are one teacher's habit. Another teacher may post "Unit 3 review" for a test, and it'd show as homework. | Words are editable on the source. A wrong one is visible and harmless (it shows as homework, not missing, until its day passes). |
| CW-C | A test's due date may be set to the wrong day by the teacher. | Use the due date; the title's date only when there's none. If they often differ, prefer the title's date (a one-line change). |
| CW-D | Google shows an "unverified app" warning on consent (0001 F-6). | Continue through "Advanced": it's the family's own app. |
| CW-E | He'll see that you can see his homework. | Tell him first; the app reads only, never hands in or comments. |
