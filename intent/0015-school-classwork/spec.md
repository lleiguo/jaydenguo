# Spec: His tests and homework from Google Classroom
Status: approved (owner, 2026-10-12, in chat: "approved"; server sign-in route, defaults kept). Written by Claude from [intent.md](intent.md).

Read with 0001 (SRC-8, SCH-1, SCH-3, SCH-4, SCH-5, SYNC-5, CRED-1..6,
spikes.md SP-5), 0004 (the iPhone Today screen), 0007 (TOOL-5 school) and
the Veracross sign-in (`src/adapters/veracross/index.ts`). IDs here: CW
(classwork), CWSEC (security).

## 1. What changes in earlier specs
- **0001 SRC-8** Classroom is read from its web pages with his school
  login (a `classroom_web` source), not the API, while the school blocks
  the app. The API connect button (M4.1) stays for if they approve it.
- **0001 CRED-2** Adds one stored login: his school Google account.
- **0001 SCH-3** Replaced by CW-3..CW-6.
- **0001 SCH-4** Grades stay deferred.
- **0001 SCH-1** The "Today at school" card gains Homework and Missing.
- **0007 TOOL-5** The school tool also answers classwork (CW-8).

## 2. Requirements

### 2.1 Signing in (CW)
| ID | Requirement | Acceptance criteria |
|---|---|---|
| CW-1 | A Classroom source per child. | Settings → Accounts: "Google Classroom (school login)" takes his school email and password (stored as 0001 CRED-1) and one owner from People. Runs daily at 06:00 and on demand, at most once an hour (SYNC-5). |
| CW-2 | Plain sign-in, saved session. | Playwright Chromium with the app's user agent (as Veracross). The saved session is tried first; Google's sign-in page gets the email, then the password, once. On success the session is saved encrypted. |
| CW-3 | Approval waits for a person; anything else stops it. | Google’s “Check your phone” / “Approve the sign-in” page is waited for, up to 5 minutes, only on a Test connection the owner started; the Accounts page says “Approve the sign-in on your phone”. A scheduled run never starts a sign-in that needs approval: if the saved session has expired, it stops with “Sign in again: press Test connection”. A code prompt waits for the owner to type it on the Accounts page. Anything else (“this browser or app may not be secure”, a CAPTCHA, “couldn’t sign you in”) ends the run with Google’s heading word for word. No password retries until the owner presses Test connection. |

### 2.2 Reading (CW)
| ID | Requirement | Acceptance criteria |
|---|---|---|
| CW-4 | What's read. | The To-do pages Assigned, Missing and Done (`/a/not-turned-in/all`, `/a/missing/all`, `/a/turned-in/all`) for title, class, due date and link, and his class list for the class switches. No other pages, no clicks but expanding the lists. At least 2 s between pages. |
| CW-5 | Classes can be left out. | The source lists his classes with a switch each, all on by default. |
| CW-6 | Tests are told apart. | A title with one of the source's test words (whole word, any case) is a test; a quiz word, a quiz. Defaults: test = "test", "exam", "feast"; quiz = "quiz", "appetizer". Editable. Tests and quizzes are never homework or missing. |

### 2.3 What's shown (CW)
| ID | Requirement | Acceptance criteria |
|---|---|---|
| CW-7 | Tests and quizzes on the calendar. | All-day events of the source on the due day (or the title's date if none), owned by the source's owner, category "school class", titled "Test · <class>: <topic>" / "Quiz · …" with the reminder prefix removed. In the all-day row, never clashing. Gone when the item is gone. |
| CW-8 | Homework and Missing on the Today card, and Cookie. | Homework: Assigned items due today to 7 days ahead, then no-due-date items posted in the last 30 days; "today"/"tomorrow" highlighted; up to 8 rows. Missing (red): Missing items due in the last 30 days that aren't tests or quizzes. Same on iPhone. The school tool gains `classwork` (tests next 30 days, homework, missing). Every row links to Classroom. |
| CW-9 | Stale or failing says so. | A failed run keeps the last good data, marked "last updated <time>", with the reason on the source. |

### 2.4 Security (CWSEC)
| ID | Requirement | Acceptance criteria |
|---|---|---|
| CWSEC-1 | The login is a secret. | Encrypted like other logins (CRED-1); never logged, never in errors, never sent to an LLM; Remove deletes it and the saved session. |
| CWSEC-2 | Only what's needed is kept. | Per item: class name, title, kind, due date, state (assigned, missing, done), link. Not descriptions, attachments, comments, classmates or teachers. Logs say counts only. |
| CWSEC-3 | Nothing personal in the repo. | Fixtures are made-up pages shaped like the real ones; the denylist check passes. |

## 3. Design
- **Credential:** kind `password` for provider `google_school`, plus a
  saved-session secret (the Veracross `BrowserSession` pattern).
- **Adapter** `src/adapters/classroom-web/`: `signIn` (CW-2, CW-3, reusing
  the Veracross code-entry flow), `readTodo` (parses the three lists from
  the page's accessible text), `listClasses`. Parsing is pure and tested
  on fixtures.
- **Domain:** `classify(title, words)` and `topicOf(title)` in
  `src/domain/classwork.ts`.
- **Data:** a new table `school_work` (id, source_id, work_key, class_name,
  title, kind `homework|test|quiz`, due_at, due_all_day, state, link,
  posted_at, updated_at), unique on (source_id, work_key); work_key is the
  Classroom item id from its link. Tests and quizzes also upsert `events`
  rows. `pnpm db:generate --name school_work`.
- **Read side:** `loadSchoolDays` adds `homework` and `missing`;
  `GET /api/v1/today` and `openapi.json`; web Today card; HubKit Today.
- **Cookie:** school tool output gains `classwork`.

## 4. Testing
- Unit: `classify`, `topicOf`; parsing scrubbed To-do fixtures; windows.
- Integration: sync against a fake Classroom and fake Google sign-in
  (e2e `fake-oidc.ts` style): success saves a session; a "verify it's
  you" page stops the run with its heading and no second password; a
  deleted item disappears.
- e2e: Today card and calendar all-day row. iPhone: HubKit fixture.
- Eval: Cookie's three questions.

## 5. Concerns for the owner
| # | Concern | Recommendation |
|---|---|---|
| CW-A | Google may challenge every sign-in from a cloud server, so this may not work at all. | SP-C3 tests it before anything else is built. |
| CW-B | Google or the school may see sign-ins from a Google Cloud address and lock or flag his account. | Sign in rarely (saved session); tell him first; stop at the first challenge. If his account is locked, stop the source. |
| CW-C | It goes around the school's app review and may be against its rules. | Owner's decision (intent). Also ask IT to approve the app (open question 4). |
| CW-D | The pages change and parsing breaks. | Fixture tests; a run that finds no lists fails loudly instead of emptying the card. |
| CW-E | His full school login is stored. | Encrypted (CRED-1), used only by this job, removable in one click. |
