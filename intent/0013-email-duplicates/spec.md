# Spec: One event per lesson, however many emails
Status: approved (owner, 2026-10-11, in chat: "draft intent and go ahead and implement it"). Written by Claude from [intent.md](intent.md).

Read with 0001 (EML-2, EML-3, CAL-6), 0004 (IEML-1), 0008 (EMS-1, EMS-2)
and the household duplicate rule (`src/domain/duplicates.ts`, PR #43,
#64). IDs here: DUP (duplicates).

## 1. What changes in earlier specs
- **0001 EML-2, 0008 EMS-1** The reader's instructions and its list of
  upcoming events change (DUP-1, DUP-2); same model, one call per email.
- **0001 EML-3, 0004 IEML-1, 0008 EMS-2** A suggestion carries the event
  it looks like a repeat of (DUP-3, DUP-4). Approving works as before.
- **Household duplicates** Email events join the rule (DUP-5, DUP-6).
- **0001 CAL-6** Stays: hidden copies aren't deleted or changed.

## 2. Requirements

### 2.1 Reading emails (DUP)
| ID | Requirement | Acceptance criteria |
|---|---|---|
| DUP-1 | Upcoming events are listed in local time. | Each line: label, title, category, where it came from (source kind), and local day and time with end, e.g. `E3: Tennis lesson with Jianyu Jia (tennis, from email), Sun 2026-10-18 10:00–11:00`; all-day events say "all day". |
| DUP-2 | Repeats and reschedules aren't new events. | The instructions say: an email about a listed event with nothing changed (reminder, payment request, receipt, confirmation) gives no suggestion; a new time or place for a listed event is a "change" of it. The prompt version becomes `email-2`. |

### 2.2 Suggestions (DUP)
| ID | Requirement | Acceptance criteria |
|---|---|---|
| DUP-3 | A new-event suggestion names the event it may repeat. | `GET /api/v1/suggestions` gives `similar: {id, title, start, end, allDay} \| null` for pending "new" suggestions: the first active, not deleted, not skipped event of the same category (not "other"), on the same day, whose time overlaps by at least half the shorter one (all day: same day and both all day). Changes and cancellations have `similar: null`. |
| DUP-4 | It's shown. | Web card: "Already on the calendar: “title”, day time". iPhone row: the same caption. Cookie's suggestion list says it too. Approve and reject work as before. |

### 2.3 Calendar (DUP)
| ID | Requirement | Acceptance criteria |
|---|---|---|
| DUP-5 | Email events give way to feeds. | An event from an email source (`gmail`) is hidden when an event from another non-household source is the same event (same category, not "other", shared owner, overlap rule as today). |
| DUP-6 | Email twins show once. | Of two email events that are the same event, the one created later stays; the other is hidden from the calendar, its clashes and the Google copy. Household events still give way to email events. |

## 3. Design
- `src/server/email/extract.ts`: `UpcomingEvent` gains `end`, `allDay`,
  `from` (source kind or "added here"); `extractPrompt` formats local
  times with the home time zone; `EXTRACT_SYSTEM` gets the two rules;
  `EMAIL_PROMPT_VERSION = "email-2"`.
- `src/server/email/apply.ts`: `upcomingEvents` selects end, all-day and
  source kind.
- `src/domain/duplicates.ts`: `EMAIL_KINDS = ["gmail"]`; `DedupEvent`
  gains `createdAt`; `householdDuplicates` (renamed
  `hiddenDuplicates`) runs: household vs other sources (as now), email vs
  feeds, email twins (newest kept), household twins (as now). A shared
  `sameEvent` check is exported for DUP-3.
- `src/server/email/suggestions.ts`: `listSuggestions("pending")` loads
  candidate events for the days of pending "new" suggestions and sets
  `similar` with the shared check (owners ignored: an email suggestion
  has none until approved).
- API schema and `openapi.json`: `similar` on `SuggestionView`.
- Web `suggestion-list.tsx`, iPhone `SuggestionsScreen.swift`, Cookie's
  suggestion tool: show it.

## 4. Testing
- Unit: the duplicate rule (email twins keep the newest, email gives way
  to a feed, a different time stays, household still gives way to
  email); the prompt lists local times; the `similar` match (same day
  overlap, different category, all day).
- Integration: a pending new suggestion over an existing event lists
  `similar`; the calendar load hides the older email twin.

## 5. Concerns for the owner
| # | Concern | Recommendation |
|---|---|---|
| D-1 | The rule can't tell a genuine second lesson at the same time from a repeat. | One child can't be at two tennis lessons at once; it's limited to email events of the same activity, and the hidden one is still stored. |
| D-2 | The model may still say "new" for a reschedule. | DUP-4 catches it at approval: the card says it's already there. |
| D-3 | Oct 18 keeps the stale 10:00 event (the reschedule was approved as new). | Skip the 10:00 "Tennis lesson with Jianyu Jia" on the calendar, and move the household entry to 11:00. |
