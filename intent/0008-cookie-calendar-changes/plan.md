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
| E2.1–E2.4 | built 2026-10-03 on `cookie/e2-google-write`; not merged. In production once merged and the owner grants "Let Cookie add events". |
| SP-E3, E3, E4 | not started. |
| E5 | waits for O-2 and a week of real suggestions (spec E-3). |

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
