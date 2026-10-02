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
| O-3 | Apply Terraform after K5 and K7 merge (Text-to-Speech API, `ASSISTANT_MODEL`, the cap). | K5, K7 |
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
| K3.3 | Daily clean-up: turn text after 90 days, forgotten memories after 30. | MEM-4, MEM-9 | Integration test with old rows. |

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
| K7.3 | Deploy, apply Terraform, TestFlight build, README and runbook notes. | — | Owner has used her for a few days (O-6). |

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
| SP-C1, SP-C3 | not started. SP-C1 needs the owner's recordings (O-1). |
| SP-C4 | price found (below); the answer quality and data terms are not checked yet. |
| SP-C5 | the format works with a synthetic clip (below); a clip recorded in the app is still to do. |
| K1.1–K1.7 | built 2026-10-02 on `cookie/k1-backend`; not merged or deployed. |
| K2.1–K2.5 | built 2026-10-02 on `cookie/k2-ios-chat` (stacked on K1); not merged, no TestFlight build yet. |
| K3–K7 | not started. |

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

**Still open from K1:** the eval's two timeouts and the speed (spec
K-11); nothing here has run on Cloud Run yet, and Terraform doesn't set
`ASSISTANT_MODEL` or the cap until K5.3 (the defaults work without).

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
