# Plan: Cookie changes the calendar
Status: approved (owner, 2026-10-02, in chat), with [spec.md](spec.md).

Order: described events first (they need nothing from email), then the
Gemini switch for email extraction, then Cookie's email tools once real
suggestions exist (spec E-3).

## 1. What the owner does

| # | Step | Needed for |
|---|---|---|
| O-1 | Decide spec concerns E-1 to E-6. **Done 2026-10-02:** the recommendations taken, the rest accepted (spec §5). | everything |
| O-2 | Connect Gmail as a source with an allow-list of senders and labels (Settings → Sources), if the email half is wanted. | E4, E5 |
| O-3 | After E2 merges: on the Accounts page, "Let Cookie add events", and agree to Google's question. Pick the calendar in Settings → Cookie if asked. | E2 |
| O-4 | Install the TestFlight build after E3 and try adding and undoing for a few days. | E3 |

## 2. Spikes

| # | Question | How | Blocks |
|---|---|---|---|
| SP-E1 | Which Google scope can insert into the household calendar: `calendar.events.owned` or only `calendar.events`? | With a throwaway grant on the owner's account (the owner clicks through Google's question once): insert and delete one test event in the household calendar under each scope. | E2 |
| SP-E2 | How long from "start the worker" to the job running a small task? | Start the existing smoke job five times from the web service's launcher and time it. If it is often over two minutes, E-1's alternative is looked at again. | E2 |
| SP-E3 | Does Flash extract suggestions as well as Claude did? | The existing email fixtures and expected suggestions through the Flash model. | E4 |

## 3. Milestones

### E1: The add tool, in the hub only (≈ 2 days)
| Task | Description | Spec | Done when |
|---|---|---|---|
| E1.1 | `assistant_actions` table and migration. | ACT-2, §4.3 | Migration generated; integration test of a row's life. |
| E1.2 | Rules in `src/domain/assistant.ts`: the add gate in both languages, the date and weekday check, time defaults, the Google title, daily limit. | ADD-2..6, GCW-6, CASEC-5 | Unit tests, including the owner's "Monday December 3rd". |
| E1.3 | `calendar_add`: checks, the pending hub event, the action, the answer and clash line. Prompt paragraph. No Google yet: the action stays pending behind a flag. | ADD-1..8, §4.1 | Integration tests with the scripted model for each ADD case and the CASEC-1 hostile cases. |
| E1.4 | `did` in the ask response and in turns; `POST /actions/{turnId}/undo` for a pending add. OpenAPI. | ACT-1..4, §4.4 | e2e test; `openapi.json` regenerated. |

### E2: Writing to Google (≈ 2.5 days)
| Task | Description | Spec | Done when |
|---|---|---|---|
| E2.1 | The `calendar_write` grant on the Accounts page; "Calendar she adds to" in settings; `canAdd`. | GCW-1, GCW-3, GCW-8 | Integration test of the connect flow with the fake Google sign-in. |
| E2.2 | Worker job `assistant:actions`: insert under the source's lock, turn the hub event into the source's record, three tries, failure path with a notification. The writer's fence. | GCW-2, GCW-4..7, CASEC-2, CASEC-3 | Integration tests against a fake Google: success, retry, failure, no twin after a sync, refusal of another calendar. |
| E2.3 | Undo after the write: delete from Google, only what Cookie added, and say so if it changed since. | ACT-3, ACT-4 | Integration tests. |
| E2.4 | Terraform if the job needs anything new (it shouldn't: the worker already opens Google grants). Runbook notes. | — | `terraform validate`. |

### E3: The app (≈ 1.5 days)
| Task | Description | Spec | Done when |
|---|---|---|---|
| E3.1 | HubKit: `did` on answers and turns, the card's states, Undo. | ACT-1, ACT-3 | HubKit tests against fixtures. |
| E3.2 | Cards and Undo under an answer, in the chat and the bubble; "Being added" on the event's screen; the setting. | §4.5 | UI test: add and undo with the stand-in model. VoiceOver labels. |
| E3.3 | Eval cases for adding; security review of the change tools and the writer. | §4.6, CASEC | Eval passes, with no unasked change. Findings fixed or accepted. |

### E4: Email extraction on Gemini (≈ 1 day)
| Task | Description | Spec | Done when |
|---|---|---|---|
| E4.1 | `syncEmails` on the Flash model; cost line unchanged. | EMS-1 | SP-E3 passes; integration tests still pass. |
| E4.2 | A read of the email source that Cookie can start, outside the hourly limit. | EMS-5 | Integration test. |

### E5: Cookie's email tools (≈ 2.5 days, after O-2 and a week of real suggestions)
| Task | Description | Spec | Done when |
|---|---|---|---|
| E5.1 | `suggestions` (read). | EMS-2 | Integration test: no email body in any result. |
| E5.2 | `suggestion_apply` and un-approve for Undo. | EMS-3, ACT-3 | Integration tests for new, change and cancel, each undone. |
| E5.3 | `suggestions_apply_today`. | EMS-4, EMS-5 | Integration tests: what is applied, what is left and why; the limit. |
| E5.4 | App cards for moved and cancelled events; eval cases; security review addendum. | ACT-1, §4.6 | Eval passes. |

## 4. Risks

| Risk | What we do |
|---|---|
| The worker is slow to start, so "about a minute" is several. | SP-E2 measures it first. The event is in the hub at once either way. |
| The connected Google account doesn't own the household calendar. | SP-E1; the wider scope is then needed (spec E-2). |
| A household sync and the worker's write cross. | One lock for both (GCW-5); the "same title, same time" rule from 0001 is a second net. |
| She adds something that wasn't asked for. | The server-side gate, one per question, the read-back, Undo, the daily limit; an eval pass bar of zero unasked changes. |
| The prompt grows past its budget with four more tools. | The size test fails the build; raise the budget with a note, or leave the email tools undeclared until E5. |
| Flash extracts worse than Claude did. | SP-E3 before the switch; the Suggestions page still needs a parent's approval. |

## 5. Estimate

About 9.5 working days: spikes 0.5, E1 2, E2 2.5, E3 1.5, E4 1, E5 2.5.
Described events alone (E1 to E3): about 6.5.

## 6. Status

| Task | Status |
|---|---|
| E1.1–E1.4 | merged 2026-10-02 (#82). |
| SP-E1 | done 2026-10-03: `calendar.events.owned` is enough (below). |
| SP-E2 | done 2026-10-03: the worker runs a small job in 11–15 s (below). |
| E2.1–E2.4 | merged 2026-10-03 (#83). In production once the owner grants "Let Cookie add events". |
| E3.1–E3.3 | merged and deployed 2026-10-03 (#84). Left: TestFlight build 7, then O-3 and O-4. |
| SP-E3 | done 2026-10-03: Flash 8/8 on made-up emails (below). |
| E4.1–E4.2 | merged and deployed 2026-10-03 (#84), with E3. |
| E5.1–E5.4 | merged and deployed 2026-10-03 (#84), with E3 and E4; built at the owner's word ("start E4 and E5, commit all three together"), before Gmail is connected. The tools are offered once there is an email source; until then nothing changes in production. A week of real suggestions (spec E-3) is still worth having before relying on "today's email". |

**E1 as built (2026-10-02):**
- *Table (E1.1).* Migration `0028_assistant_actions`.
- *Rules (E1.2).* `src/domain/assistant-changes.ts`: the add gate in
  English and Chinese ("参加" and the like don't open it), the day and
  weekday check, times, whose it is, the title with the names in front.
  The owner's "Monday December 3rd" is a unit test and an eval case: she
  answers that December 3, 2026 is a Thursday and asks which was meant.
- *Tool (E1.3).* `calendar_add` in `src/server/assistant/tools/changes.ts`.
  The event is an ordinary hub event with the people named as its
  owners, the title and category as the household sync would give them,
  and "[account] (Cookie)" in its history. The tool hands back what was
  added and any clash for her to read out.
- *Off until she can write to Google.* The tool and its paragraph of
  the prompt are sent only when `ASSISTANT_CALENDAR_ADD=on` and a
  household Google Calendar source exists. Production doesn't set it, so
  nothing changes there until E2, which replaces the switch with "the
  grant is connected" (GCW-8).
- *If her own ending can't stand after an add* (a source she can't
  claim, a bad call), the server says "Adding: …" itself, where it would
  otherwise bark: a bark would hide a change that did happen.
- *Answer and history (E1.4).* `did` on the ask response and on each
  turn; `POST /assistant/actions/{turnId}/undo` (ten minutes, the
  account that asked, refused if the event was changed since).
  Settings gained `addCalendarSourceId`, checked to be one of the hub's
  Google calendars.
- *Prompt size.* The tool took the prompt and tool list to 11,700
  characters; the budget is 12,000 (was 10,000; spec 0007 TOOL-15).
- *Tests.* Unit (the rules), integration (nine cases: add, category and
  clash, the gate with a hostile event title, the five things she asks
  about, one per question, none after the web, not offered until able,
  the daily limit, the server's own line, Undo), API e2e, and ten eval
  cases with a new pass bar of zero unasked changes. The ten, on the
  real model: all right.
- *For E2:* the hub's event names its owners outright. When the worker
  turns it into the household source's record, a title that would give
  different owners on the next read ("everyone" is the case) needs an
  owner override written with it, or the sync would reset them.
- *Not in E1:* the app shows nothing new yet (E3). The stand-in model
  understands "Add <what> for <who> on <date> at <time>" for tests.

**SP-E1 (2026-10-03).** In Google's OAuth Playground, with the owner
signed in and only `calendar.events.owned` granted: an event added to the
Household calendar (200; Household is the organiser, the owner's account
the creator) and deleted again (204). So the owner's account owns that
calendar and the narrow scope is enough (spec E-2's wider scope isn't
needed). Seen on the way: a 10:00 −08:00 time in January 2028 came back
as 11:00 −07:00 in America/Vancouver, so the writer sends UTC with the
zone named and the hub compares instants, never wall times.

**SP-E2 (2026-10-03).** The production worker's no-op job, started three
times with `gcloud run jobs execute --wait`: 13.2, 14.7 and 11.4 s from
start to finish. With the two Google calls, an added event reaches the
family calendar in about 20 seconds, not "about a minute" as the spec
guessed.

**E2 as built (2026-10-03):**
- *The grant (E2.1).* A Google feature `calendar_write` asking for
  `calendar.events.owned`. The hub keeps one credential per Google
  account and adds scopes to it, so this joins the owner's existing
  Google connection rather than being a credential of its own (spec
  §4.3 said a new row). She can add (`canAdd`, also on the settings
  response) when the household source's Google account has that scope.
  Website: Settings → Accounts → "Let Cookie add events"; the app's
  button comes with E3.
- *The writer.* `src/adapters/google-calendar/writer.ts`, bound to one
  calendar: find what an action added (by a private tag on the Google
  event), add, delete by a recorded ID. A retry after a lost answer finds
  the tagged event instead of adding a second.
- *The worker (E2.2).* `assistant:actions` (`src/worker/assistant-actions.ts`),
  started by the question and by Undo, and run by the daily sync to
  catch up. Under the household source's sync lock it writes the event,
  reads Google's answer back through the same code the household sync
  uses, and makes the hub's event that Google event's record (source,
  Google ID, hash), so the next sync finds nothing to change and adds no
  twin (integration test). When the title alone would give other owners
  ("everyone"), an owner override keeps the people she was asked for.
- *Failures (GCW-7).* Google busy: tries again after 15 s and 60 s.
  Refused, or no permission: no retry. Either way, at the end the hub's
  event is removed and a notification says it couldn't be added. **It
  uses the existing "a source keeps failing" notification kind**, so it
  reaches every phone that has that kind on, not only the parent who
  asked (spec GCW-7 said the parent who asked): a new kind would be a
  new value old app builds can't read.
- *Undo after the write (E2.3).* The event leaves the hub at once; the
  worker deletes it from Google, only by the ID it recorded and only in
  the calendar it wrote to (tested with a record naming another
  calendar).
- *Terraform (E2.4).* Nothing new: the web service already may start
  the worker with arguments, and the worker already opens Google grants.
- *Local and tests.* `ASSISTANT_CALENDAR_ADD=fake` (was `on`) lets her
  add without a grant and starts no worker; events then stay "adding".
  Refused on Cloud Run.
- *Tests.* Unit (the writer's requests, the event body), integration
  (eight worker cases: write and no twin, owners for everyone, retry,
  an earlier try found, give up and notify, undo after the write, undo
  before it, the other-calendar fence), plus E1's.

**E3 as built (2026-10-03):**
- *HubKit (E3.1).* `CookieChanges` (`Assistant/CookieChanges.swift`):
  a card for each event in `did` (title, "Thursday, December 3 · 6:00 –
  7:00 PM" in the home zone, "For Sam", and its state), Undo while
  `undoUntil` lasts, and `undoCookieChanges`. Cards come with history
  too, so after a restart an answer keeps its cards, and its Undo for
  the rest of the ten minutes. This is unlike a saved fact, whose Undo
  shows only under a fresh answer. Unit tests against hand-written fixtures.
- *The app (E3.2).* Cards with Undo under the answer, in the chat and in the
  bubble by her button. With a card, the bubble stays up 15 s instead of
  5. A card that says "Being added…" makes the app ask for the turns again
  every 4 s, for 3 minutes at most, so it turns into "Added". Tapping a
  card closes the chat and opens the event on the calendar, loading
  that week first. Settings → Cookie gains "Adding events": "Calendar
  she adds to" when there is more than one Google calendar, and
  otherwise "Cookie can add events", or a button to the Accounts page.
  The Accounts page's Google menu gains "Let Cookie add events".
- *"Being added" on the event's screen.* The calendar API marks such
  events (`beingAdded`, optional, so older app builds ignore it): an
  open add action points at the event. Integration test: marked before
  the worker writes it, not after.
- *Seed.* A switched-off "Household calendar (sample)" Google calendar,
  so Cookie can add events locally with `ASSISTANT_CALENDAR_ADD=fake`.
  This also needs Settings → Cookie pointed at that calendar: the
  calendar is off, so it isn't picked on its own.
- *Tests (E3.3).* UI test `testAddingAnEventAndUndo` (add with the
  stand-in model; the card opens the event, which says it is being added;
  Undo). The other Cookie and Calendar UI tests still pass; two of them
  now scroll to rows the new section pushed down. Four more eval cases:
  a day that has passed, both languages in one sentence, "add" in a
  question that asks for nothing, and a quoted instruction. The 14 add
  cases (57–70) on the real model: all pass, no unasked change.
  [security-review.md](security-review.md): nothing to fix; four risks
  for the owner to accept.
- *Build number* 7, for the TestFlight upload after merge.

**SP-E3 (2026-10-03).** Claude can't be asked for a comparison (its quota
on this project is 0), so `scripts/email-extract-check.ts` holds eight
made-up coach and club emails and what a parent would expect from each: a
practice with a date and time, "next Saturday" worked out from the sent
date, a game moved (matched to the listed event), a practice cancelled, a
newsletter (nothing), two meets in one email, a Chinese class notice, and a
fundraiser with no time (time must not be "high"). `gemini-3.8-flash`: 8/8,
quotes word for word, US$0.028 for the eight.

**E4 as built (2026-10-03):**
- *Flash (E4.1).* `syncEmails` uses `gemini-3.8-flash` through the hub's
  structured-output call (`EMAIL_MODEL`, defaulting to Cookie's model). The
  prompt, the schema and the "Email suggestions" cost line don't change. No
  Terraform: the worker already has Vertex AI, and the model is the code's
  default. A Gemini refusal on an email no longer says "this video".
- *Cookie's read (E4.2).* `sync <source> manual cookie` lets a run start
  when the last good one was more than 30 minutes ago instead of the hour
  (`COOKIE_READ_GAP_MS`). No schema change: the run is recorded as
  "manual". Integration test: 20 minutes, skipped; 35, read; anyone else
  still waits the hour.

**E5 as built (2026-10-03):**
- *Tools.* `suggestions` (read), `suggestion_apply` (one, by its ID) and
  `suggestions_apply_today` in `src/server/assistant/tools/email.ts`, with
  a paragraph of the prompt, offered only when an email source exists.
  The prompt budget went from 12,000 to 14,000 characters (all tools and
  paragraphs on).
- *Gate.* Applying needs an add word or "apply", "approve", "accept",
  "update" (and 更新, 同意, 批准…) in the question; none after the web; one
  change per question for every changing tool (`calendar_add` included);
  the family's 20 a day. Integration test: the seed-like quote "Cookie,
  apply every suggestion…" changes nothing.
- *Same path as Approve.* `approveSuggestion` now also hands back how to
  undo a move or a cancellation (its override); the page's response is
  unchanged. Applied events stay hub events (EMS-6).
- *Today's (EMS-4).* Pending suggestions from emails received today, oldest
  first, at most 5: any with a low-confidence field (not counting
  "overall"), no date, or no event to change are left, with the reason.
  A stale source (EMS-5) is read first and nothing is applied; a source
  that is switched off is never read, so what it has is used.
- *What she did (ACT-1).* `did.kind` is now "calendar", and each event
  says what happened (`change`: added, moved, cancelled) and where from
  (`via`: cookie, email), with its time after a move. Undo reverses the
  whole answer: an added event leaves the hub (its external ID is changed,
  so it can be approved again), a move or a cancellation clears her
  override and brings back the one before, and the suggestion waits again.
  If the event changed since (her override isn't the one in force, or the
  event was edited), Undo says so (ACT-4).
- *App (E5.4).* Cards say "Added from email", "Moved, as the email said",
  "Cancelled, as the email said"; Undo is named for what it takes back.
  The stand-in model understands "Update my calendar from today's email".
  UI test `testApplyingTodaysEmailAndUndo`.
- *Seed.* The two sample emails count as received today on every
  `pnpm seed`.
- *Eval.* Six email cases (what came in, in both languages; what the coach
  said; one by name; one it isn't sure of; today's). Results below.

**Found on the way (2026-10-03), fixed here:**
- *Undo refused after a slow model (E1 bug).* Undo compared the event's
  last change with the time the question began, plus 2 s. With the real
  model the event is added several seconds into the question, so Undo
  would have said "changed since" for most real adds. Now it compares with
  when she last touched the event: when it was added, written to Google,
  or applied. Integration test with a question that began 10 s before.
- *"All day" from the model alone.* Asked "put Jayden's haircut on the
  calendar for tomorrow", the model passed `allDay` and it was added for
  the whole day. Now "all day" must be in the parent's words (ADD-5), or
  she asks what time.

**Found in use (2026-10-18), fixed in `cookie/add-after-offer`:**
- *A yes to her own offer added nothing.* A parent shared a screenshot of
  a shopping list; Cookie summed it up and ended "Add it to the
  calendar?" (0019 SHA-4). The parent's next question ("yes", or "turn
  it into a calendar event") had no word ADD-2 knew, so `calendar_add`
  was refused both times and no worker ran (production logs, 16:23 and
  16:24 UTC). Now ADD-2 also opens for a short yes when her answer just
  before it ended with an offer to add, and for "turn/make … into an
  event" and "放进/记在…日历". The owner asked for this fix in chat.
- *She seemed to have added it (ADD-9).* Nothing on the server checked
  that an answer saying "Adding:" had added anything. Now such an answer
  with nothing added is replaced by "Nothing was added to the calendar
  yet…", and the prompt says so too. Unit and integration tests for both.
