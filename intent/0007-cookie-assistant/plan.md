# Plan: Cookie, a voice-first family assistant
Source: [spec.md](spec.md). Status: draft (2026-10-01). Building starts
when the owner approves the spec.

Same working agreement as [0001's plan](../0001-jayden-hub/plan.md) §1:
one PR per milestone or smaller, each listing its task IDs; nothing
merges with red CI (including `pnpm format:check`); this file is updated
in the same commit when the build departs from it. Backend tasks keep
`pnpm lint`, `typecheck`, `test`, `test:int` and `test:e2e`; app tasks
add `xcodebuild test` for HubKit and the UI tests they touch.

Order: spikes first, because the transcript spike decides whether voice
is built at all. Then the backend with typing on the website, which is
the cheapest way to try her answers every day. Voice and the iPhone app
come last, on a backend that already answers well.

---

## 1. Owner prerequisites

| # | Step | Needed by |
|---|---|---|
| O-1 | Record 20 or more real questions with the family on the iPhone (Voice Memos): some English, some Mandarin, most mixed, with the names, places and sport terms you actually say. Keep them on the Mac outside the repo; write down what was said in each. | SP-C1 |
| O-2 | Decide spec concerns K-1 (voice processed outside Canada), K-2 (web on or off by default), K-5 (what she may answer on her own), K-6 (anything not said aloud) and K-10 (the icon's place). | K1 (K-5), K4 (K-2), K5 (K-1), K6 (K-6, K-10) |
| O-3 | Apply Terraform after K5 and K7 merge (Text-to-Speech API, `ASSISTANT_MODEL`, the cap). | K5, K7 |
| O-4 | Optional: a short recording of Cookie barking (spec K-8). | K6 |
| O-5 | Add the school, street and club names to "Never send to the web" in Settings → Cookie. | K4 |
| O-6 | Install the TestFlight build and use her for a few days before K7 closes. | K7 |

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

### K2: Website chat box (≈ 2 days)
| Task | Description | Spec | Done when |
|---|---|---|---|
| K2.1 | Floating avatar button and chat panel in the app layout: history, sources, errors, limit messages. | CK-1, CK-4, CK-8, CHR-4 | e2e with the fake model; keyboard and screen-reader checks (NFR-9). |
| K2.2 | Settings → Cookie: cap, use the web, clear history. | LIM-5, MEM-9 | e2e. |

### K3: Memory (≈ 2 days)
| Task | Description | Spec | Done when |
|---|---|---|---|
| K3.1 | `memory_search`, `memory_save`, `memory_forget`; keyword search over text and bilingual keywords. | TOOL-8..10, MEM-1, MEM-3, MEM-5..8 | Integration tests, including refusal after a web tool and both language directions. |
| K3.2 | Memory routes; Memory list in Settings → Cookie; "Saved to memory · Undo" in the chat. | MEM-2, MEM-4 | e2e: save by chat, undo, edit, forget, restore. |
| K3.3 | Daily clean-up: turn text after 90 days, forgotten memories after 30. | MEM-4, MEM-9 | Integration test with old rows. |

### K4: Web tools (≈ 2 days)
| Task | Description | Spec | Done when |
|---|---|---|---|
| K4.1 | `web_search`: separate grounded call, query filter, "never send to the web" list. | TOOL-11, TOOL-17, CSEC-3 | Unit tests for the filter; integration test with a scripted search. |
| K4.2 | `web_fetch`: link allow rule, address checks on every redirect, size, time and type limits, HTML to text. | TOOL-12, CSEC-4 | Unit tests for private, loopback, link-local and metadata addresses and a redirect to one; integration test against a local page. |
| K4.3 | Hostile-content tests: a page and an event title that tell her to save a memory or fetch a link with hub data. | CSEC-6 | Both attempts refused in integration tests. |

### K5: Voice on the backend (≈ 2 days)
| Task | Description | Spec | Done when |
|---|---|---|---|
| K5.1 | Audio in `/ask`: size and length checks, clip passed to the model, `heard` returned, spelling list. Chirp in front only if SP-C1 says so. | VOX-1..4, LIM-3, CSEC-2 | Integration test with a fixture clip (synthetic speech, not the family) and the scripted model; a test that nothing is written to disk or logs. |
| K5.2 | `GET /turns/{id}/speech`: Text-to-Speech with the SP-C3 voice; counted against the cap; off at 80%. | VOX-5, LIM-5 | Integration test against a fake speech service. |
| K5.3 | Terraform: enable Text-to-Speech, `ASSISTANT_MODEL` and cap on the web service, the service account's role. | §3 | `terraform validate`; owner applies (O-3). |

### K6: iPhone (≈ 5 days)
| Task | Description | Spec | Done when |
|---|---|---|---|
| K6.1 | HubKit: assistant client and types from the regenerated OpenAPI, recorder, player. | §4.5, CSEC-2, CSEC-8 | HubKit tests against recorded responses. |
| K6.2 | The floating button: overlay in `RootView`, hold to record with level ring and haptics, slide off to cancel, limits, hidden where CK-1 says. Microphone permission text. | CK-1, CK-2, CK-6, CK-7 | UI test for visibility; by hand on the phone for the hold. |
| K6.3 | Bubble and speech: heard text, answer, bark sound then speech, tap to stop, fallback to the phone's voice. | CK-3, CHR-2, VOX-5 | By hand on the phone; UI test with the fixture clip flag. |
| K6.4 | Chat sheet: history, typing, mic button (tap to start and stop), sources, Saved to memory with Undo. | CK-4, CK-5, MEM-2 | UI test: tap, type, answer. VoiceOver pass. |
| K6.5 | Settings → Cookie: Memory, History, Spoken answers, Use the web, cap. | MEM-4, MEM-9, VOX-5 | UI test for the Memory list. |

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
| SP-C1 fails with both Gemini and Chirp. | Ship K1–K4 (typing on web and iPhone) and stop; voice gets a new intent. |
| Forced tool calls with audio don't work on Flash (SP-C2). | Fall back to JSON output for the final turn; the grounding check doesn't change. |
| Answers are slower than VOX-6. | Lowest thinking setting, fewer rounds for common questions (`today()` covers most), speech fetched after the text. If still slow, raise the web service's minimum instances for the feature's hours. |
| The prompt and tool list grow as tools are added. | The size test (TOOL-15) fails the build. |
| Prices or model IDs change. | Model ID is an environment variable; `pricing.ts` logs a model it can't price. |

---

## 5. Estimate

About 21 working days: spikes 2, K1 4, K2 2, K3 2, K4 2, K5 2, K6 5,
K7 2.

---

## 6. Status

| Task | Status |
|---|---|
| Spikes SP-C1..5 | not started (SP-C1 needs O-1) |
| K1–K7 | not started |
