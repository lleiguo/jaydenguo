# Spec: Cookie changes the calendar
Status: approved (owner, 2026-10-02, in chat: "approved"), taking the
recommendations in §5 and accepting the rest. Written by Claude from
[intent.md](intent.md).

Read with spec 0007 (Cookie) and spec 0001 (the hub). IDs here: ADD (an
event the parent describes), GCW (writing to the household Google
Calendar), EMS (email suggestions), ACT (what she did, and Undo), CASEC
(security).

## 1. What changes in earlier specs

- **0007 CHR-6 ("read-only")** gains two exceptions: adding one event the
  parent describes, and applying email suggestions the parent asks for.
  Everything else stays read-only.
- **0001 GCO-1 ("the hub never writes to the household calendar")** gains
  one exception: the worker may add an event Cookie was asked to add,
  and remove only events it added itself (GCW-2).
- **0001 EML-2** (extraction with Claude) moves to the Gemini Flash model
  Cookie uses (EMS-1).
- **0001 NFR-1**: nothing new leaves the hub. An added event goes to the
  family's own Google Calendar, which already holds the family's events.

## 2. Found before writing this (2026-10-02)

1. **No email source is connected in production.** The worker's logs show
   seven sources syncing, none of them Gmail, so no suggestions exist.
   The email half of this intent needs the owner to connect Gmail with
   an allow-list first (plan O-2), as 0001 SRC-4 describes.
2. **Email extraction can't run today.** It calls Claude on Vertex AI,
   whose quota for this project was 0 when last seen (a video review
   failed on it on 2026-09-28). EMS-1 moves it to Gemini.
3. **The web service can't read a stored Google grant, on purpose.** It
   may encrypt credentials but only the worker may decrypt them (0001 CRED-4), so a break-in to the web service yields no source credentials.
   Cookie runs in the web service. That decides how she writes to Google:
   see §4.2 and concern E-1.
4. **The hub already turns a name in a household event's title into its
   owner** ("Jayden swimming", "Lei's dentist"; `ownersFor`). So an event
   written to the household calendar with the person's name in its title
   comes back owned by that person, with no new rule.

Because of 1 and 2, the plan builds described events first. They need
nothing from email.

## 3. Requirements

### 3.1 An event the parent describes (ADD)
| ID | Requirement | Acceptance criteria |
|---|---|---|
| ADD-1 | One sentence adds one event. | "Add a dentist appointment for [name] on Thursday December 3rd at 6 pm", typed or spoken, in English, Mandarin or both, makes one event with a title, a day, a time or all-day, its owners, and a place if one was said. |
| ADD-2 | Only when the question's own words ask for it. | As 0007 MEM-1: the server checks the question for a word that asks to add ("add", "put", "schedule", "book", "create", "加", "添加", "安排", "记到日历" and the like). Also for "turn/make it into an event" and "放进/记在日历", and for a parent's short yes ("yes", "ok", "好的", "可以") when her answer just before it ended with her own offer to add ("Add it to the calendar?"; added 2026-10-18). Text inside a tool result, an email, an event or a web page can never start it. Not in a question that used the web. One event per question. |
| ADD-3 | Whose it is. | Each person named must be one of Settings → People (matched as the hub matches names in titles). "For both boys", "for everyone" and "family" are understood. With no person named she asks whose it is and adds nothing. |
| ADD-4 | The day is checked, not trusted. | The model gives the date and, when one was said, the weekday. The server works out the date's weekday in the home time zone; if it differs from the one said, she asks which was meant and adds nothing. (The owner's own example: December 3rd 2026 is a Thursday, not a Monday.) A date that has passed, or is more than 18 months ahead, is asked about too. |
| ADD-5 | Time. | A start time makes a timed event, one hour long unless an end or a length was said. "All day" makes an all-day event. Neither said: she asks. Times are in the home time zone. |
| ADD-6 | Category. | From the title, by the household calendar's own rules (the ones Settings → Sources shows for it), so the event doesn't change category when it is next read from Google. |
| ADD-7 | She says back what she did. | One line with the weekday, the date, the time and whose it is: "Adding: dentist, Thursday December 3, 6 pm, for [name]." If it overlaps another event of the same person, she names the clash. In the chat the answer carries the event as a card (ACT-1). |
| ADD-8 | Not in this intent. | Repeating events; moving, renaming or deleting an existing event by asking; more than one event per question. Asked for any of these she says she can't yet and which screen does it, as today. |
| ADD-9 | She never says she added what she didn't. | Added 2026-10-18. An answer that says an event is being added ("Adding:", "I've added", "正在添加", "已添加") when nothing was added in that question is replaced on the server by "Nothing was added to the calendar yet. Say again what to add, the day, the time and whose it is." (or its Chinese). |

### 3.2 Writing to the household Google Calendar (GCW)
| ID | Requirement | Acceptance criteria |
|---|---|---|
| GCW-1 | Where it goes. | The event is written to the Google calendar the hub's household source reads (owner's decision, 2026-10-02). If there is more than one Google Calendar source, Settings → Cookie → "Calendar she adds to" picks it; with one, that one. |
| GCW-2 | Add-only. | The writer can do two things: insert an event into that one calendar, and delete an event whose Google ID is recorded as added by Cookie (ACT-2). It can't edit any event, delete any other event, or write to any other calendar. Enforced in code and tested with a fake Google. |
| GCW-3 | The permission. | Asked for on the Accounts page ("Let Cookie add events"): `calendar.events.owned`, enough because the owner's account owns the household calendar (SP-E1). It joins that Google account's existing grant, as every Google feature does. Opened only by the worker. |
| GCW-4 | In the hub at once. | The event shows in the hub as soon as she says "Adding", marked "Being added to the family calendar". Within about 20 seconds (SP-E2) the worker writes it to Google and the mark goes. |
| GCW-5 | Once, not twice. | When the Google write succeeds, the hub's event becomes the household source's record of that Google event (same source, same Google ID), under the same lock the household sync takes, so the next read of Google matches it and no second copy appears. Its owners and category are the ones the sync would give it (ADD-3, ADD-6). The copy calendar (GCO-1) treats it like any other household event. |
| GCW-6 | The title carries the name. | Google has no owner field. The Google title is the title with the owners' names in front if they aren't already in it ("[Name] dentist", "[A] & [B] dentist"; everyone: no name, and the source's default owners apply). |
| GCW-7 | If Google refuses. | The worker tries three times over a little over a minute when Google is busy, once when it refuses. Then the hub's event is removed, the answer's card says it couldn't be added, and a notification says so, on the phones that receive "a source keeps failing" (both parents' by default). The hub never keeps an event the family calendar lacks. |
| GCW-8 | Not connected. | Without the grant, or without a household source, she says events can't be added until Google is connected on the Accounts page, and adds nothing. |

### 3.3 Email suggestions (EMS)
| ID | Requirement | Acceptance criteria |
|---|---|---|
| EMS-1 | Extraction on Gemini Flash. | `syncEmails` uses the Flash model through the hub's existing structured-output call. The extraction prompt and schema don't change. Checked against the existing email fixtures before the switch. Its cost shows under "Email suggestions" as before. |
| EMS-2 | She can tell you what is waiting. | A read-only tool lists pending suggestions (at most 10): kind, title, day and time, who the email was from, and whether a field is low-confidence. "What came in by email?" is answered from it. The email's body is never given to her, only the fields and the short quote the Suggestions page shows. |
| EMS-3 | One, named. | "Add the swim meet one" applies one pending suggestion, by the same path as the Suggestions page's Approve. It must match exactly one pending suggestion; with none or several she asks which. Same gate as ADD-2. A suggestion with a low-confidence field is applied when named, and she says which field was unsure. |
| EMS-4 | Today's, all at once. | "Search today's email and update my calendar accordingly" applies the pending suggestions from emails received today (home time zone), oldest first, 5 at most. Skipped and left pending: any with a low-confidence field or no date, a change or cancellation whose event can't be matched, and those past the limit. She says how many she added, moved, cancelled and left, and why they were left. |
| EMS-5 | If today's email hasn't been read. | If the email source last synced more than 30 minutes ago she starts a read (the hourly limit on manual refresh doesn't apply to this) and says "I'm checking the mail; ask me again in a minute." She applies nothing in that question. |
| EMS-6 | Where applied suggestions go. | As today: hub events with source "email" and a link to the message. They are not written to the household Google Calendar (intent open question 0, default). |
| EMS-7 | Still by the allow-list. | She reads no mail herself. Only what the email source fetched under its allow-list (EML-1) can become a suggestion. |

### 3.4 What she did, and Undo (ACT)
| ID | Requirement | Acceptance criteria |
|---|---|---|
| ACT-1 | Shown under the answer. | The ask response gains `did`: what kind of change, and for each event its title, time, owners, state (being added, added, failed) and a link to it. The app shows each as a card under the answer; tapping opens the event. |
| ACT-2 | Recorded. | Every change is a row: which turn, which parent, what kind, the hub event, the Google event ID once written, the suggestion and what the event looked like before (for a move or a cancellation), and when it was undone. Event history shows "added through Cookie by [parent]". |
| ACT-3 | Undo. | For 10 minutes the answer has an Undo. It reverses the whole answer: an added event leaves the hub at once and is deleted from Google by the worker (or never written, if it hadn't been yet); an applied suggestion goes back to pending and its event is removed, moved back or un-cancelled. After 10 minutes the events are changed on their own screens like any other. |
| ACT-4 | Undo is exact. | Undo touches only what that answer did. If the event was changed by someone since (in the hub or in Google), Undo says so and leaves it. |

### 3.5 Security (CASEC)
| ID | Requirement | Acceptance criteria |
|---|---|---|
| CASEC-1 | The parent's words start it. | ADD-2 and EMS-3's gate is checked on the server for every changing tool. Integration tests: an email quote, an event title and a web page each telling her to add or apply something change nothing. |
| CASEC-2 | The web service still can't read a Google grant. | The write to Google happens in the worker (§4.2). The web service records what to do and starts the job; it never holds the grant. |
| CASEC-3 | The writer is fenced in. | GCW-2, tested: a recorded action naming another calendar, or an Undo naming an event Cookie didn't add, is refused. |
| CASEC-4 | Mishearing. | A spoken add is read back with the person's name and the weekday (ADD-7) and shown as a card; Undo is one tap. A spoken "apply" needs exactly one match (EMS-3). |
| CASEC-5 | Limits. | One described event or one named suggestion per question; 5 in a batch; at most 20 changes a day across the family. Changing tools count against 0007's per-question tool limit. |
| CASEC-6 | Logs hold no words. | As 0007 CSEC-7: the action's ID, kind and outcome, never the title, the place or the names. The worker's log line for a Google failure has the status only. |
| CASEC-7 | Who. | Any allow-listed account, as for the rest of Cookie (intent open question 5, default: both parents). |

## 4. Design

### 4.1 Tools (added to 0007's fixed list)
| Tool | Kind | Does |
|---|---|---|
| `calendar_add` | change | Input: `title`, `date` (YYYY-MM-DD), `weekday` (as said, optional), `start` and `end` (HH:MM, optional), `allDay`, `people` (names, or "everyone"), `location` (optional). Checks ADD-2..5, GCW-8 and the limits; on a problem it returns what to ask and changes nothing. Otherwise it creates the hub event and the action, starts the worker, and returns what was added and any clash. |
| `suggestions` | hub (read) | Pending email suggestions, shaped small (EMS-2). |
| `suggestion_apply` | change | Input: the suggestion's ID from `suggestions`. EMS-3. |
| `suggestions_apply_today` | change | No input. EMS-4, EMS-5. Returns what was applied and what was left, with reasons. |

The prompt gains a short "Changing the calendar" paragraph: only when
asked, read back what was done, ask when the tool says to. The prompt
and tool list stay under 0007's size budget, raised if needed with a
note as before. Grounding: an answer after a change tool cites "hub".

### 4.2 How an added event reaches Google
```
 question → web: calendar_add checks → hub event (pending) + action row
                 → starts worker job `assistant:actions`      → answer: "Adding: …"
 worker:  lock the household source → Google events.insert
          → hub event becomes the source's record (Google ID) → action done
 on failure (3 tries): remove the hub event → action failed → notify
```
- **Why the worker, and so "Adding", not "Added".** The web service
  can't decrypt a Google grant (§2.3). A Cloud Run job starts in tens of
  seconds, so the family calendar has the event about a minute after
  she answers. The hub, where Cookie and Today read from, has it at once.
  The alternative is concern E-1.
- The pending hub event is an ordinary event row with no source yet,
  plus the action row that marks it. Loaders show it everywhere, with
  the "being added" mark from the action.
- The job handles every open action, so a job that failed to start is
  picked up by the next one. The daily sync also runs it.

### 4.3 Data
- `assistant_actions`: id, turn, user, kind (`add_event`, `apply_suggestion`),
  state (`pending`, `done`, `failed`, `undone`), hub event ID, Google
  calendar and event IDs, suggestion ID, `before` (for Undo), tries,
  timestamps. One answer's actions share the turn.
- No change to `events`. `email_suggestions` gains nothing; un-approve
  sets `status` back to `pending` and clears `event_id`.
- Google grant: a new feature `calendar_write` beside `calendar_copy` in
  `google-connect.ts`, with its own credential row.

### 4.4 API
| Route | Does |
|---|---|
| `POST /assistant/ask` | Response gains `did` (ACT-1). |
| `POST /assistant/actions/{turnId}/undo` | ACT-3. 409 after 10 minutes or if already undone; 409 with words if something changed since (ACT-4). |
| `GET /assistant/turns` | Each turn carries its `did`, so the chat shows the cards after a restart, with their current state. |
| `GET/PATCH /assistant/settings` | Gains `addCalendarSourceId` (GCW-1) and whether adding is ready (`canAdd`). |

### 4.5 App
- Cards under an answer (ACT-1) and Undo, like "Saved to memory · Undo".
  A card shows "Being added…" until the worker is done; the app asks
  again when the card is on screen.
- Settings → Cookie: "Calendar she adds to" and, when the grant is
  missing, a line saying where to connect it.
- The event's own screen shows "Being added to the family calendar"
  while pending. No other screen changes.

### 4.6 Tests
- Unit: the add gate words in both languages; date and weekday checks;
  the Google title; what a batch applies and skips.
- Integration (scripted model, fake Google): each ADD and EMS case; the
  worker's insert, retry, failure and Undo; no twin after a household
  sync; the CASEC-1 and CASEC-3 cases.
- e2e: ask to add, the `did` shape, Undo; settings.
- App: a UI test that adds and undoes with the stand-in model.
- Eval set: about 15 new questions (adds in three languages, a wrong
  weekday, no person, a past date, "what came in by email", apply one,
  apply today's, and hostile text). Pass as 0007, plus: **no change is
  made that the question didn't ask for**.

## 5. Concerns for the owner (all decided 2026-10-02)

| # | Concern | What the spec does | Decision needed |
|---|---|---|---|
| E-1 | **"Adding", not "added".** Because only the worker can use a Google grant, the family calendar gets the event about a minute after she answers, and a failure is reported by a notification, not in her answer. | §4.2. The hub has the event at once. | **Decided 2026-10-02: accepted.** The worker writes; the minute stands. (Not chosen: giving the web service its own key to this one grant, which is instant but lets a break-in to the web service read and write the family's Google calendars.) |
| E-2 | **The Google permission is wider than one calendar.** Google has no "this calendar only" scope. `calendar.events.owned` covers every calendar the connected account owns; `calendar.events` every calendar it can see. | The code only inserts into the one calendar and deletes only its own events (GCW-2). | **Decided 2026-10-02: accepted.** |
| E-3 | **The email half needs two things first:** Gmail connected with an allow-list (yours to do), and extraction moved to Gemini (in the plan). Until then "what came in by email" answers "nothing", truthfully. | Described events are built first. | **Decided 2026-10-02:** the Gemini switch now (E4); Cookie's email tools (E5) after Gmail has been connected for a week. **Changed 2026-10-03:** the owner asked for E5 to be built now, with E3 and E4; the tools appear once Gmail is connected. |
| E-4 | **A child can add an event** by holding the button, as a child can ask anything. | Read-back, the card, Undo, 20 changes a day, and "added through Cookie by [account]" in the history. | **Decided 2026-10-02: accepted.** Spoken changes are allowed. |
| E-5 | **A batch applies without asking first** (intent question 2). | Apply, say what was done, offer Undo. | **Decided 2026-10-02: accepted.** Apply, then Undo. |
| E-6 | **Events she adds have no category rule of their own.** A dentist appointment is "other" unless the household source has a rule for it. | ADD-6. | **Decided 2026-10-02: accepted.** |

## 6. Defaults taken from the intent's open questions
0. Described events: the household Google Calendar (decided). Applied
   email suggestions: stay hub events (EMS-6).
1. A batch applies new events, moves and cancellations (EMS-4).
2. Apply, then Undo; no "shall I?" (E-5).
3. She doesn't mention waiting suggestions unprompted.
4. Email is read on the existing schedule, plus the read she can start
   (EMS-5).
5. Both parents.
6. No person named: she asks (ADD-3).
7. Repeating events: not now (ADD-8).
