# Plan: Cookie, a voice-first family assistant
Source: [spec.md](spec.md). Status: approved (owner, 2026-10-02, in
chat). K1 is built; see Status and Spikes at the end.

Same working agreement as [0001's plan](../0001-jayden-hub/plan.md) §1:
one PR per milestone or smaller, each listing its task IDs; nothing
merges with red CI (including `pnpm format:check`); this file is updated
in the same commit when the build departs from it. Backend tasks keep
`pnpm lint`, `typecheck`, `test`, `test:int` and `test:e2e`; app tasks
add `xcodebuild test` for HubKit and the UI tests they touch.

Order: spikes first, because the transcript spike decides whether voice
is built at all. Then the backend, then typed chat in the iPhone app, so
the owner can try her answers every day from a TestFlight build. Voice
comes last, on a backend that already answers well.

Changed 2026-10-02 (owner): Cookie is in the app only; the website chat
box (the old K2) is dropped from this intent and decided later. The
app's typed chat moved forward from K6 to take its place.

---

## 1. Owner prerequisites

| # | Step | Needed by |
|---|---|---|
| O-1 | Record 20 or more real questions with the family on the iPhone (Voice Memos): some English, some Mandarin, most mixed, with the names, places and sport terms you actually say. AirDrop them to the Mac into `~/cookie-recordings/` (outside the repo), named `01.m4a`, `02.m4a`, …, with a `said.txt` beside them: one line per clip, the number and the words as spoken. | SP-C1 |
| O-2 | Decide spec concerns K-1, K-2, K-5, K-6 and K-10. **Done 2026-10-02:** K-1 accepted, defaults kept for the rest (spec §5). | — |
| O-3 | Apply Terraform after K5 and K7 merge (the web service's role on Vertex AI, Text-to-Speech API, `ASSISTANT_MODEL`, the voice, the cap). Cookie doesn't work on Cloud Run before this. | K5, K7 |
| O-7 | Listen to the voice samples in `~/cookie-recordings/voices/` (SP-C3) and pick a speaker, or keep "Leda". | K6 |
| O-4 | Optional: a short recording of Cookie barking (spec K-8). | K6 |
| O-5 | Add the school, street and club names to "Never send to the web" in Settings → Cookie. | K4 |
| O-6 | Install the TestFlight build after K2 (typed chat) and after K6 (voice), and use her for a few days before K7 closes. | K2, K7 |

---

## 2. Spikes (first; each time-boxed to half a day)

Run from the owner's Mac with Application Default Credentials, as SP-6
of 0001 was. Clips of the family stay off the repo and out of chat.

| # | Question | How | Unblocks |
|---|---|---|---|
| SP-C1 | Are Gemini's transcripts of mixed Mandarin and English good enough, and fast enough? | Send O-1's clips to `gemini-3.8-flash` with the VOX-3 spelling list; compare with what was said. Pass: key terms right in 18 of 20 (VOX-1), answer text under 3 s median (VOX-6). If it fails, repeat with Chirp in front. | K5, K6 |
| SP-C2 | Does one call take audio in, call tools, and end on a forced `answer` or `bark`? What does a question cost? | A script with two fake tools. Record tokens per round (audio, prompt, tools, output), the lowest thinking setting that still picks the right tool, and whether any Canadian region serves the model with audio (K-1). Add the model's price to `pricing.ts`. | K1 |
| SP-C3 | Which voice reads a mixed sentence well, how fast, at what price, from which region? | Ten mixed answers through two or three Cloud Text-to-Speech voices and through `AVSpeechSynthesizer`; the owner listens and picks. | K5 |
| SP-C4 | Does a search-grounded call that sees only the query return a short answer and sources? Price per search, and Google's data terms for it? | Ten general questions (opening hours, a venue's address, a rule). Read the terms for stored queries (K-2). | K4 |
| SP-C5 | Which recording format does Vertex take inline from the iPhone? | Record AAC 16 kHz mono in a test build; send it. Note size per second and tokens per second. | K5, K6 |

Results go in a `## Spikes` section of this file. Spec §3's cost paragraph
is replaced with SP-C2's numbers.

---

## 3. Milestones and tasks

### K1: Backend, typed questions (≈ 4 days)
| Task | Description | Spec | Done when |
|---|---|---|---|
| K1.1 | Schema: `assistant_turns`, `assistant_memories` (`pnpm db:generate --name assistant`). | §4.4 | Migration merged. |
| K1.2 | Pure rules in `src/domain/assistant.ts`: grounding check, per-question limits, answer length, prompt size budget. | CHR-1..3, LIM-1, TOOL-15 | Unit tests. |
| K1.3 | Model loop in `src/server/assistant/`: Gemini with tools and forced terminal calls; scripted model; `ASSISTANT_LLM=fake`. | §4.1, §4.2 | Integration test: two-round question, bark on unknown, bark at the round limit. |
| K1.4 | Hub tools TOOL-1..7 over the existing loaders, each with input and output schemas and a 6,000-character cap. | TOOL-1..7, TOOL-15..18, CHR-5 | Integration test per tool on seed data; CSEC-5 test (no credentials in any result). |
| K1.5 | `POST /ask` (text only), `GET`/`DELETE /turns`, settings routes; rate limits, monthly cap, cost per turn; OpenAPI regenerated. | §4.3, LIM-2..6, CSEC-1, CSEC-7 | Integration tests; route-list e2e (401 signed out). |
| K1.6 | Costs: "Cookie" as a fourth AI feature on the Costs page and API. | LIM-6, COST-4 | Unit and e2e tests updated. |
| K1.7 | Eval set and `pnpm assistant:eval`. | §4.6 | First run's results pasted here; pass bars met. |

### K2: iPhone, typed chat (≈ 4 days)
| Task | Description | Spec | Done when |
|---|---|---|---|
| K2.1 | HubKit: assistant client and types from the regenerated OpenAPI. | §4.5, CSEC-8 | HubKit tests against recorded responses. |
| K2.2 | The floating button (tap only for now): overlay in `RootView`, hidden where CK-1 says, dimmed offline. | CK-1, CK-7 | UI test for visibility. |
| K2.3 | Chat sheet: history, typing, sources, errors and limit messages. | CK-4, CHR-4, MEM-9 | UI test: tap, type, answer (fake model). VoiceOver pass. |
| K2.4 | Settings → Cookie: cap and this month's spend, clear history. ("Use the web" moves to K4.) | LIM-5, MEM-9 | UI test. |
| K2.5 | API e2e through the built server with the fake model: ask, history, settings. | §4.6, CSEC-1 | e2e green. |

### K3: Memory (≈ 2 days)
| Task | Description | Spec | Done when |
|---|---|---|---|
| K3.1 | `memory_search`, `memory_save`, `memory_forget`; keyword search over text and bilingual keywords. | TOOL-8..10, MEM-1, MEM-3, MEM-5..8 | Integration tests, including refusal after a web tool and both language directions. |
| K3.2 | Memory routes; in the app, the Memory list in Settings → Cookie and "Saved to memory · Undo" in the chat. | MEM-2, MEM-4 | API e2e: save by chat, undo, edit, forget, restore. UI test for the Memory list. |
| K3.3 | Daily clean-up: turn text after 90 days, forgotten memories after 30 (in the daily sync run). | MEM-4, MEM-9 | Integration test with old rows. |

### K4: Web tools (≈ 2 days)
| Task | Description | Spec | Done when |
|---|---|---|---|
| K4.1 | `web_search`: separate grounded call, query filter, "never send to the web" list; "Use the web" and that list in the app's Settings → Cookie. | TOOL-11, TOOL-17, CSEC-3 | Unit tests for the filter; integration test with a scripted search. |
| K4.2 | `web_fetch`: link allow rule, address checks on every redirect, size, time and type limits, HTML to text. | TOOL-12, CSEC-4 | Unit tests for private, loopback, link-local and metadata addresses and a redirect to one; integration test against a local page. |
| K4.3 | Hostile-content tests: a page and an event title that tell her to save a memory or fetch a link with hub data. | CSEC-6 | Both attempts refused in integration tests. |

### K5: Voice on the backend (≈ 2 days)
| Task | Description | Spec | Done when |
|---|---|---|---|
| K5.1 | Audio in `/ask`: size and length checks, clip passed to the model, `heard` returned, spelling list. Chirp in front only if SP-C1 says so. | VOX-1..4, LIM-3, CSEC-2 | Integration test with a fixture clip (synthetic speech, not the family) and the scripted model; a test that nothing is written to disk or logs. |
| K5.2 | `GET /turns/{id}/speech`: Text-to-Speech with the SP-C3 voice; counted against the cap; off at 80%. | VOX-5, LIM-5 | Integration test against a fake speech service. |
| K5.3 | Terraform: enable Text-to-Speech, `ASSISTANT_MODEL` and cap on the web service, the service account's role. | §3 | `terraform validate`; owner applies (O-3). |

### K6: iPhone, voice (≈ 3 days)
| Task | Description | Spec | Done when |
|---|---|---|---|
| K6.1 | HubKit: recorder and player (AVFoundation); audio in the ask call. Microphone permission text. | §4.5, CSEC-2, CK-6 | HubKit tests. |
| K6.2 | Hold to talk on the floating button: level ring and haptics, slide off to cancel, limits. | CK-2, CK-6 | By hand on the phone. |
| K6.3 | Bubble and speech: heard text, answer, bark sound then speech, tap to stop, fallback to the phone's voice. | CK-3, CHR-2, VOX-5 | By hand on the phone; UI test with the fixture clip flag. |
| K6.4 | Mic button in the chat sheet (tap to start and stop); "Spoken answers" in Settings → Cookie. | CK-5, VOX-5 | UI test with the fixture clip flag. VoiceOver pass. |

### K7: Release (≈ 2 days)
| Task | Description | Spec | Done when |
|---|---|---|---|
| K7.1 | Eval set on the release build's prompt and model; VOX-6 timings on the phone. | §4.6, VOX-6 | Results pasted here. |
| K7.2 | Security review of the assistant routes and tools (`security-review.md` in this folder). | §2.7 | Findings fixed or accepted by the owner. |
| K7.3 | Terraform applied by the owner 2026-10-02; #79 deployed; TestFlight 1.0.0 (6) uploaded and the same build installed on the owner's phone; first questions asked in production (below). Left: a few days' use (O-6), the voice pick (O-7), the review's risks and K-12. |

---

## 4. Risks during the build

| Risk | What we do |
|---|---|
| The model is slower than VOX-6 allows (found in SP-C2: spec K-11). | Measure from Cloud Run in K7.1 before deciding. |
| SP-C1 fails with both Gemini and Chirp. | Ship K1–K4 (typed chat in the app) and stop; voice gets a new intent. |
| Forced tool calls with audio don't work on Flash (SP-C2). | Fall back to JSON output for the final turn; the grounding check doesn't change. |
| Answers are slower than VOX-6. | Lowest thinking setting, fewer rounds for common questions (`today()` covers most), speech fetched after the text. If still slow, raise the web service's minimum instances for the feature's hours. |
| The prompt and tool list grow as tools are added. | The size test (TOOL-15) fails the build. |
| Prices or model IDs change. | Model ID is an environment variable; `pricing.ts` logs a model it can't price. |

---

## 5. Estimate

About 22 working days: spikes 2, K1 4, K2 4, K3 3, K4 2, K5 2, K6 3,
K7 2.

---

## 6. Status

| Task | Status |
|---|---|
| SP-C2 | done 2026-10-02 (below). |
| SP-C1 | done 2026-10-02 (below): passes, at the bar. |
| SP-C3 | measured 2026-10-02 (below); the owner's pick by ear is open. Built with "Leda". |
| SP-C4 | done 2026-10-02 (below). |
| SP-C5 | Voice Memos clips from the iPhone (48 kHz mono AAC, `.m4a`) are accepted as `audio/mp4` (SP-C1); a clip recorded by the app itself (16 kHz mono AAC, 24 kbit/s, about 3 kB a second) is accepted too, tried on the simulator in K6. A real phone is still to try (O-6). |
| K1.1–K1.7 | built 2026-10-02 on `cookie/k1-backend`; not merged or deployed. |
| K2.1–K2.5 | built 2026-10-02 on `cookie/k2-ios-chat` (stacked on K1); not merged, no TestFlight build yet. |
| K3.1–K3.3 | built 2026-10-02 on `cookie/k3-memory`; not merged. |
| K4.1–K4.3 | built 2026-10-02 on `cookie/k4-web` (stacked on K3); not merged. |
| K5.1–K5.3 | built 2026-10-02 on `cookie/k5-voice`; not merged, Terraform not applied (O-3). |
| K6.1–K6.4 | merged 2026-10-02 (#77). Tried on the simulator; not yet on a phone (O-6). |
| K7.1 | eval done 2026-10-02 (below): pass. First timings from Cloud Run and the phone taken 2026-10-02 (below). |
| K7.2 | done 2026-10-02: [security-review.md](security-review.md); six findings fixed, seven risks for the owner to accept. |
| K7.3 | Code deploys by itself on merge. Runbook notes written (README → Runbook → Cookie); build number set to 6 (another change took 5). **Waiting on the owner:** apply Terraform (O-3), then the TestFlight build and a few days' use (O-6). |

**K1 as built (2026-10-02):**
- *Schema (K1.1).* Migration `0027_assistant`: `assistant_turns` and
  `assistant_memories` (the memory table is used from K3).
- *Rules (K1.2).* `src/domain/assistant.ts`. A tool that answers with an
  error (bad input, nothing found) doesn't count as a source, so "the
  calendar had nothing" can't back an answer.
- *Loop (K1.3).* `src/server/assistant/`. The time and the people go in
  front of the question, not in the system prompt, so the prompt and
  tool list stay identical between questions. Turns that end in a limit
  or an error are saved too (with no cost), so the chat shows them.
- *Tools (K1.4).* The seven hub tools. System prompt plus definitions:
  under the 8,000-character budget (unit test).
- *Routes (K1.5).* `POST /ask` (typed), `GET`/`DELETE /turns`,
  `GET`/`PATCH /settings` (the API has no PUT, so the spec's PUT became
  PATCH). History is per account; "Clear history" clears every
  account's. "Use the web" is off by default (K-2). `ASSISTANT_LLM=fake` gives a stand-in model for local use and
  end-to-end tests (refused on Cloud Run).
- *Costs (K1.6).* "Cookie" on the Costs page and in the API's
  `features` (`assistant`); the iPhone Costs screen and its fixture got
  the same line, so the next app build shows it.
- *Eval (K1.7).* `pnpm assistant:eval`, 43 questions over seed data
  (it refuses any other database). Third run, 2026-10-02, on
  `gemini-3.8-flash` with thinking off: made-up answers 0; answerable
  right 32 of 33 (97%); too long 0; no reply from the model 2 (both
  timed out, see SP-C2). Pass.

**K2 as built (2026-10-02):**
- *HubKit (K2.1).* `HubKit/Assistant/AssistantTypes.swift`: the chat's
  rules (bubbles from turns, source lines, which conversation a
  follow-up continues, the question limit), tested against hand-written
  fixtures. The two Cookie GETs are never cached on the phone (CSEC-8).
- *Button (K2.2).* An overlay in `RootView`, so it is over every tab and
  pushed screen; hidden while locked, behind the privacy cover, signed
  out, and on the video review screen (the whole screen, not only the
  full-screen player). It moves up while the undo banner shows. Its
  VoiceOver name is "Ask Cookie", so it isn't confused with the
  Settings row.
- *Chat (K2.3).* A sheet. The chat lives in memory for as long as the
  app runs and is fetched again (last 30 turns) on the next start;
  signing out forgets it.
- *Settings (K2.4).* More → Settings → Cookie: this month's spend, the
  monthly limit (a stepper, US$0–50) and "Clear history". **"Use the
  web" is left out until K4**: a switch for tools that don't exist yet
  would mislead. Memory and "Spoken answers" join in K3 and K6.
- *Tests (K2.5).* `tests/e2e/assistant.spec.ts` (API through the built
  server, fake model, responses checked against `openapi.json`);
  `HubAppUITests/CookieTests` (ask, bark, history after a restart,
  settings and clear). The UI tests' server now needs
  `ASSISTANT_LLM=fake` (ios/README).

**K3 as built (2026-10-02):**
- *Tools (K3.1).* `memory_search`, `memory_save`, `memory_forget`
  (`src/server/assistant/tools/memory.ts`), in the prompt after the hub
  tools. Saving and forgetting are gated on the question's own words
  (`asksToRemember`, `asksToForget` in `src/domain/assistant.ts`), not
  only on the prompt: a hostile event title can't start either. A fact
  that names a password or holds a card-length number is refused
  (`looksSecret`). One save and one forget per question.
- *Search.* In memory over all facts: a search word matches a fact's
  text or its keywords, in either direction; most matches first, then
  newest; 8 at most. A fact added by hand has no keywords, so it is
  found by the words in its text only.
- *Prompt size.* The memory tools took the prompt and tool list from
  7,400 to 8,900 characters, over TOOL-15's 8,000. The budget is now
  10,000 (spec updated): about 30% more tokens in per round.
- *Routes (K3.2).* `GET`/`POST /memories`, `PATCH`/`DELETE
  /memories/{id}`, `POST /memories/{id}/restore`. The ask response
  gained `saved` and `forgot`. "Undo" in the chat forgets what was
  saved, or restores what was forgotten.
- *App (K3.2).* Settings → Cookie → Memory: the list, add, edit, swipe
  to forget, a Forgotten section with restore. "Saved to memory · Undo"
  under the answer for 10 s. The memory list is never cached on the
  phone.
- *Clean-up (K3.3).* In the daily `sync all` run, beside the
  notification clean-up, so there is no new scheduled job or Terraform.
- *Tests.* Unit (the three rules), integration (save, both language
  directions, refusals, one per question, forget and restore, edit,
  clean-up), API e2e, a UI test (remember, undo, the Memory list), and
  seven memory cases in the eval set.

**K4 as built (2026-10-02):**
- *Google's terms changed the design* (spec §4.7, read in SP-C4). A
  search's answer must be shown as it is and not mixed or rewritten, so
  `web_search` **ends the question**: the server returns Google's
  answer word for word with its pages and searches as links, and it
  never goes back to Cookie's model. And a result's links may not be
  followed by software, so `web_fetch` reads **only a link written in
  the question**, not one from a search. Spec TOOL-11, TOOL-12, CSEC-3
  and CSEC-4 are rewritten to match.
- *Search (K4.1).* `src/server/assistant/web.ts`: one grounded call that
  sees only the query and is asked for two sentences in the question's
  language, or `NO_ANSWER`. An answer with no page behind it is treated
  as no answer. The query filter (`webQueryProblem`) refuses the
  people's names and the private words. Each Google search is counted
  at US$0.014 against the cap, though the first 5,000 a month are free.
- *Off means absent.* While "Use the web" is off the web tools and the
  prompt's web paragraph aren't sent, so they cost no tokens.
- *Fetch (K4.2).* `guardedFetch`: `node:https` with a DNS lookup that
  refuses non-public addresses at connection time, so there is no gap
  between checking an address and using it. Tried live: a public page
  reads; the metadata host and a name that resolves to 127.0.0.1 are
  refused; a site that blocks bots answers 403 and she says so. The
  "integration test against a local page" became unit tests with a
  made-up transport, because the fetcher refuses local addresses by
  design.
- *Hostile content (K4.3).* A page and an event title that tell her to
  save a memory, fetch another link or search for a person: all refused
  (integration tests).
- *App.* Settings → Cookie: "Use the web" and "Never send to the web"
  (add and remove words). Web answers show their pages and searches as
  links under the bubble.
- *Limits.* A second search or a second page in one question is over
  LIM-1 and ends it in a bark.
- *Eval, 2026-10-02 (K3 and K4 together), 54 questions:* made-up
  answers 0; answerable right 39 of 43 (91%); too long 0; no reply from
  the model 6 (Vertex was still failing now and then, and all four
  wrong answers were among those). Every memory case that got a reply
  was right: saved in one language and recalled in the other, a
  password refused, forgotten, then a bark. With the web on, two world
  questions were answered by a live search with their pages, a hub
  question still came from the hub, and a family question the hub can't
  answer got a bark, not a search. Median 7.9 s on a bad Vertex day.

**K5 as built (2026-10-02):**
- *Spoken questions (K5.1).* `POST /ask` takes `audio: { data, mimeType }`
  (base64) in place of `text`. As SP-C1 advised, the clip is
  **transcribed first** (`src/server/assistant/transcribe.ts`: one call,
  the spelling list, no system prompt, no tools but `heard`), and the
  words then take the typed path unchanged. The answer loop never sees
  the clip. Spec VOX-1, §3 and §4.1 are updated to say so.
- *Checks.* AAC in an MPEG-4 file only, 1 MB and 30 s at most; the
  length is read from the file's own header (`mp4Seconds`), so a clip
  is refused before any model is called. A clip with no words in it gets
  "Woof! I didn't catch that." without asking the answer model.
- *Spelling list (VOX-3).* The people's names, then the places the
  calendar's events name most often (the part before a comma, street
  addresses left out), 40 names at most. The hub has no separate list
  of clubs and venues, so this is where their names come from.
- *What is kept.* The turn records `voice`, the clip's length, and the
  transcription's tokens and cost with the loop's. A fact saved by a
  spoken question is marked as saved by voice. The clip is in memory
  for the request and nowhere else; the integration test checks that
  no row or log line holds it, and that the logs hold no words.
- *Spoken answers (K5.2).* `GET /turns/{id}/speech`
  (`src/server/assistant/speech.ts`): Text-to-Speech, MP3, not stored.
  Links aren't read, and a web answer starts "From the web:". Each
  reading is added to the turn's characters and cost at the list price
  (reading it twice counts twice). Not audio: 404 (not this account's
  turn, or cleared), 409 (spoken answers off, or the spend at 80% of the
  cap), 429 (30 readings in 5 minutes), 503 (the voice didn't answer).
  The app falls back to the phone's voice on all of them (K6).
- *Stand-ins.* With `ASSISTANT_LLM=fake` every clip is heard as "What's
  on today?" and the speech is a quarter-second tone, so K6's UI tests
  need no Google service.
- *Terraform (K5.3).* **Nothing of Cookie works on Cloud Run until this
  is applied (O-3):** the web service had neither `VERTEX_PROJECT` nor
  a role on Vertex AI, because until now only the worker called a model.
  Added: `roles/aiplatform.user` for the web service account; the
  Text-to-Speech API (already on in the project, now in Terraform);
  `VERTEX_PROJECT`, `GEMINI_VERTEX_REGION`, `ASSISTANT_MODEL`,
  `ASSISTANT_VOICE` and `ASSISTANT_MONTHLY_CAP_USD` on the web service.
  `terraform validate` passes. Text-to-Speech needs no role of its own;
  that is to be confirmed on the first deploy (if it is refused, the
  phone's voice reads the answers and nothing else breaks).
- *Tried live once* (owner's Mac, seed data, synthetic clips): an
  English and a mixed question were heard right, answered from the hub
  and read aloud. 7 s and 22 s to the text (Vertex was slow again; the
  second took three lookups), then 2 s for the speech. Speed stays as
  in spec K-11.
- *Tests.* Unit (clip header, clip checks, what is read aloud, voice
  choice, the two Google calls with made-up transports), integration
  (the five spoken-question cases, four speech cases), API e2e (a clip
  in, speech out, refusals). The fixture clip is a macOS voice saying
  "What's on today?".

**K6 as built (2026-10-02):**
- *Rules in HubKit, audio in the app (K6.1).* The plan put the recorder
  and player in HubKit. Built instead: `HubKit/Assistant/CookieVoice.swift`
  holds the rules (what lifting the finger does, the level ring, the
  ask body, what is read aloud, which phone voice), tested without a
  simulator; the AVFoundation code is in the app
  (`HubApp/Features/Cookie/CookieAudio.swift`), because the audio
  session only exists on iOS and HubKit's tests run on the Mac.
- *Recording.* AAC in an MPEG-4 file, 16 kHz mono, in a protected
  temporary file that is deleted as soon as the clip is read or the
  recording cancelled (CSEC-2). **The microphone is started off the
  main thread:** the first try on the simulator froze the screen inside
  the system's "start recording" call. If the microphone hasn't started
  after 3 s she says so, and typing still works.
- *Hold to talk (K6.2).* On her button: 0.2 s starts recording with a
  haptic, a red ring that swells with the voice, and "Listening… 0:02";
  lifting sends; sliding off turns the ring grey and lifting cancels;
  under half a second shows "Hold to talk"; 30 s sends by itself. A
  plain tap still opens the chat. Offline, a hold says so (CK-7).
- *Microphone permission (CK-6).* Asked on the first hold, with the
  reason. Refused: a line says the microphone is off, with a button to
  Settings.
- *Bubble and speech (K6.3).* What she heard and her answer show in a
  bubble by the button; tapping it opens the chat, where the same turn
  is. The answer is read by the server's voice; if that gives anything
  but audio, by the phone's voice in the answer's language. A tap on
  her button, or a new hold, stops the speech. The bubble closes 5 s
  after she stops speaking (8 s when nothing is spoken). There is no
  separate bark sound: the voice says "Woof!" (spec K-8).
- *The chat's mic button (K6.4).* Tap to start, tap to send, so nothing
  needs a long press (CK-5); while she speaks, the same button stops
  her. A spoken question in the chat is answered in the chat and read
  aloud; typed ones are never read.
- *Settings.* "Spoken answers" in Settings → Cookie. Off, nothing is
  read and no speech is fetched.
- *Leaving the app* stops the recording and the speech. Speech uses a
  playback-only audio session, so it never touches the microphone.
- *Tests.* HubKit: 10 tests of the rules. UI tests
  (`HubAppUITests/CookieTests`): hold to ask and the bubble, a short
  press, the mic button, the "Spoken answers" switch. They start the
  app with `-HubCookieClip` (debug builds only), which hands the
  recorder a made-up clip, so the microphone is never used in a test.
- *By hand on the simulator:* the real recorder, a hold, the level
  ring, and the server accepting the app's own recording.
- **Not yet tried, and only a phone can:** how the voices sound, the
  haptics, the microphone question as the system shows it, Bluetooth
  and the silent switch (she speaks even when the phone is on silent,
  because the question was asked out loud), and VoiceOver end to end.
  These are O-6.

**K7 as built (2026-10-02):**
- *Eval (K7.1).* `pnpm assistant:eval` on `gemini-3.8-flash`, prompt
  `cookie-3`, seed data, 54 questions (typed; English, Mandarin, mixed;
  hub, memory, the web on and off): **made-up answers 0; answerable
  right 42 of 43 (98%); too long 0; no reply from the model 1** (a
  Vertex timeout, the one miss). Pass. Median 4.1 s, slowest 20.6 s,
  from the owner's Mac. 215,000 tokens in, 6,600 out: US$0.23 for the
  run, about 0.4 cents a question.
- *Speed (VOX-6) is still not met and not yet measured where it
  counts.* 4.1 s median against the 3 s target, typed, from a home
  connection; a spoken question adds the transcription call (about 2 s)
  and the speech (about 1–2 s after the text). The owner accepted this
  (spec K-11). Measuring from Cloud Run and on the phone needs Terraform
  applied first.
- *Security review (K7.2).* `security-review.md`. Fixed: error logs
  that could quote a question or a memory; a page that could talk her
  into a web search; IPv6 forms of private addresses; path IDs that
  aren't IDs; a recording left on the phone by a crash; and (not
  security) a crash, not "can't answer right now", when Vertex AI isn't
  set up, which is production's state until O-3.
- *Release (K7.3).* What is done: the runbook notes, and the app's
  build number is 6 (another change took 5 while this was in review). What isn't, and why: **Terraform is the owner's to
  apply (O-3)**, and until it is, production has her code but she
  answers every question with "Cookie can't answer right now"; a
  TestFlight build before that would show exactly that, so it follows
  O-3. Checked 2026-10-02: the web service has none of her settings and
  no role on Vertex AI yet.
- *After O-3, to finish K7:* ask her a typed and a spoken question in
  production and read the timings from the logs (`assistant turn`,
  `ms`); confirm Text-to-Speech answers for the web service account;
  upload build 6; the owner uses her for a few days (O-6) and picks a
  voice (O-7).

**In production (2026-10-02, after O-3):** the owner asked three
questions from the phone on build 6. From the web service's logs, which
hold no words:

| Question | To the text | Lookups | Result | Speech |
|---|---|---|---|---|
| spoken | 5.9 s | `today` | answer | her own voice, 1.6 s, 34 kB |
| spoken | 16.7 s | memory, swimming, calendar, tennis | **bark: round limit** | her own voice, 0.6 s |
| typed | 3.8 s | `today` | answer | none (typed) |

- Vertex AI and Text-to-Speech both answer for the web service account;
  Text-to-Speech needed no role of its own.
- Speed from Cloud Run is about what it was from the owner's Mac: 3.8 s
  typed, 5.9 s spoken, against the 3 s target (spec K-11).
- **One question used all four rounds on lookups and never answered,**
  so the server barked after 16.7 s and four lookups were thrown away.
  **Fixed the same day:** on her last round, or once her five lookups
  are used, she may only call `answer` or `bark` (the model call names
  them as the only allowed functions; the tool list itself doesn't
  change). So three rounds of looking are followed by an answer from
  what she found. Eval after the change, with two questions across
  several areas added (56 in all): made-up 0; right 44 of 45 (98%); no
  reply 1. Both new questions were answered from the calendar, tennis
  and swimming together.
- **No sound on the phone.** The owner saw both spoken answers in the
  bubble but heard nothing for at least the bark. The server sent the
  audio both times, and on the simulator the player starts. Not yet
  explained: the phone's media volume, or a fault only a real device
  shows. Added to tell them apart: a "Speaking" line in the bubble
  while she reads, and the player is told the audio is MP3 and made
  ready before it plays. Open until tried again on the phone.

**Still open from K1:** the eval's timeouts and the speed (spec K-11);
nothing here has run on Cloud Run yet.

---

## Spikes

### SP-C2: audio in, tools, forced ending, cost (2026-10-02, done)

Run from the owner's Mac against project `jaydenguo`, a few cents in
all. No recording of the family was used: the audio test was one
sentence spoken by a macOS voice ("Jayden 明天几点有 swim practice？").

- **It works in one call.** `gemini-3.8-flash` takes the clip inline
  (16 kHz mono AAC in an `.m4a`, sent as `audio/mp4`, 14 kB for 2.8 s),
  calls a tool, and ends on a forced `answer` or `bark` (function
  calling mode `ANY`). The transcript came back as spoken, both
  languages intact. That is a synthetic voice in a quiet room: SP-C1
  with real voices is still the test that counts.
- **Audio is about 25 tokens a second** (72 tokens for 2.8 s).
- **Thinking.** `thinkingBudget: 0` is accepted and still picked the
  right tool; `MINIMAL` is refused for this model; `LOW` added 40–230
  thinking tokens a round with no better choices. Built with 0.
- **Regions (spec K-1).** Only `global` serves the model for this
  project: `northamerica-northeast1` and `us-central1` answer 404,
  `northamerica-northeast2` 400. So voice clips would be processed
  outside Canada, as video is.
- **Price** (pricing page, 2026-10-02): US$0.75 per million tokens in
  (text or audio) and US$3.75 out until 2026-12-31, then US$1.50 and
  US$7.50. Search grounding: 5,000 queries a month free, then US$14 per
  1,000.
- **Cost per question** (eval run): 43 questions used 134,000 tokens
  in and 3,600 out, US$0.114: about a quarter of a cent each.
- **Speed: worse than VOX-6 asks.** A model call took 1.1–4 s even for
  "say the number 3"; a hub question needs two. Median over the eval
  set 4.7 s, a quarter over 7 s. The SDK retries 5 times with up to a
  minute between tries by default, which showed as stalls of 30–90 s;
  Cookie's calls now time out at 12 s with one retry and 25 s per
  question, and 2 of 43 questions still got no reply in one run. All of
  this is from a home connection; K7.1 measures from Cloud Run.

### SP-C1: transcripts of real mixed-language questions (2026-10-02, done)

The owner recorded 20 questions on the iPhone (O-1): 9 in English, 3
in Mandarin and 8 mixing both. `scripts/assistant-transcripts.ts` sent
them to `gemini-3.8-flash` and printed what was heard beside what was
said. The clips and the sentences stay on the owner's Mac; nothing from
them is in the repo.

- **Result: 18 of 20 with every key term right** (names, subjects, sport
  terms, the event and distance), with the spelling list. That is the
  pass bar in VOX-1, with nothing to spare. One run, one speaker.
- **The two misses.** One Mandarin clip named one child and was heard
  as the other, in every run: the worst kind of miss, because the
  answer would be about the wrong child. One mixed clip lost "this
  week" to a similar-sounding phrase in one run and was right in
  another. The transcript on screen (VOX-2) is what catches both.
- **Harmless differences**, not counted as misses: a name said in
  Mandarin written in English, "swim" heard as "swimming", grammar
  tidied ("has" to "have"), a question mark added.
- **The spelling list matters (VOX-3).** Without the people's names,
  the primary person's name was misspelt in 10 of 20 clips. With them,
  never.
- **Speed.** The transcript alone took a median 2.6 s. Vertex was slow
  and patchy during the test (single calls of 10–50 s, one 504).
- **Sent the way the spec draws it** (the clip goes into the tool loop,
  and the transcript comes back in the final `answer` or `bark`): the
  first tool call was the right one for 19 of 20 clips, so she
  understands the questions. But the transcript only exists once the
  loop ends, and a loop that hits its limit ends with none. This was
  measured with empty tool results, so its timings mean nothing.

**For K5.1: transcribe first, then ask.** One call turns the clip into
text (with the spelling list); the text then goes through the same loop
as a typed question. The transcript is always there and shows while she
is still looking, the answer is about exactly the words on screen, and
voice reuses the path the eval set already covers. It costs one more
model call per spoken question (about 2.5 s and a few hundredths of a
cent). Spec §4.1 and §3 say "one call gives the transcript and the tool
calls"; they change when K5.1 is built. Chirp is not needed.

### SP-C3: the voice (2026-10-02, measured; the owner's pick is open)

`scripts/assistant-voices.ts` read ten made-up answers (English,
Mandarin, and both in one sentence, with times, a swim time and club
names) through five Text-to-Speech voices, and saved the MP3s outside
the repo for the owner to listen to.

- **Chirp 3 HD voices** (Leda, Aoede, Kore, Puck): about 1.0 s an
  answer (slowest 1.4 s), about 19 kB each as MP3. Each speaker has a
  Mandarin and an English voice under the same name; the Mandarin one
  reads a sentence with English words in it. Sent back through Cookie's
  own transcription, every mixed sentence came back with its English
  and Chinese words right (differences were digits for number words and
  punctuation). "汪！" was heard as "哇" for two of the voices.
- **WaveNet** (the older kind): 0.5 s, twice the size, and a flatter
  sound; kept in the samples for comparison.
- **Price** (pricing page, 2026-10-02): Chirp 3 HD is free for the first
  million characters a month, then US$30 per million. A family's
  answers are tens of thousands of characters a month. WaveNet: 4
  million free, then US$4 per million.
- **Region:** the global Text-to-Speech endpoint; the answer's text is
  processed outside Canada, as the question is (spec K-1).
- **Not tried:** Gemini's own speech models (preview, priced per token)
  and `AVSpeechSynthesizer` on a phone, which K6 uses as the fallback.
- **Built with "Leda"** (`ASSISTANT_VOICE`, a Terraform variable). The
  owner listens to the samples and names another speaker if one is
  better; that is a one-word change.

### SP-C4: search grounding (2026-10-02, done)

- **It works as a separate call that sees only the query.** Four
  questions (pool hours, a tennis rule, tomorrow's weather, a venue's
  address in Mandarin) each came back with a one- or two-sentence
  answer in the query's language and 1–4 source pages.
- **Sources** come as a site name and a Google redirect link, not the
  page's own address. One search prompt made 1–4 Google searches.
- **Speed:** 4–17 s per search. Much slower than a hub question.
- **Price:** 5,000 searches a month free, then US$14 per 1,000; plus
  about 60 tokens in and 40–140 out.
- **Data terms** (Service Specific Terms, read 2026-10-02): queries are
  stored up to three days for debugging, not tied to the customer or
  its users. The use restrictions are summarised in spec §4.7; they
  changed the design of both web tools.

