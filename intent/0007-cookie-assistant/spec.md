# Spec: Cookie, a voice-first family assistant
Source: [intent.md](intent.md). Status: approved (owner, 2026-10-02, in
chat: "spec and plan looks good, let's start the implementation"). The
intent's open questions are answered by the defaults in §6, which the
owner kept on 2026-10-02 along with the decisions recorded in §5.

Cookie lives in the iPhone app only, with voice and typing (owner,
2026-10-02: app first, the website is decided later). All of her
thinking happens on the server, behind one new API route, with a fixed list of tools.

Changes to earlier specs:
- 0001 NFR-1 (where data about the family goes) gains four lines: voice
  clips and questions to Gemini on Vertex AI; answer text to Google Cloud
  Text-to-Speech; web search queries to Google Search through Vertex AI;
  and requests for public web pages. The last two carry no hub data
  (CSEC-3, CSEC-4).
- 0002 COST-4 gains a fourth AI feature, "Cookie".
- 0004: one new permission on the phone (microphone). The API change is
  additive (API-6).

---

## 1. Principles

- **Server decides, clients show.** As in 0004 §1: the prompt, tools,
  limits and grounding rules live on the server. The app records, sends,
  shows and plays.
- **Read-only.** Cookie reads the hub through the same loaders the pages
  use. Her memory is the only thing she writes.
- **Grounded or a bark.** Every answer names where it came from, and the
  server checks that claim against the tools that actually ran (CHR-3).
- **Small by design.** A short prompt, narrow tools, capped results and
  a hard stop on rounds. Cost is measured per question and capped per
  month.
- **Web content is data.** Nothing read from the web, or from text the
  hub scraped, can make her call a tool.

---

## 2. Requirements

### 2.1 Reaching her (CK)
| ID | Requirement | Acceptance criteria |
|---|---|---|
| CK-1 | Her avatar is the button. | A round button with the app icon's artwork sits bottom-right above the tab bar on every app screen. Hidden on sign-in, while the app is locked (SEC-2) and over the full-screen video player. Fixed in place in v1: dragging would fight press-and-hold. |
| CK-2 | Press and hold to talk (iPhone). | Holding for 0.2 s starts recording with a haptic and a level ring round the icon. Releasing sends. Sliding off the icon before releasing cancels. Shorter than 0.5 s is discarded with the hint "Hold to talk". Recording stops and sends at 30 s. |
| CK-3 | Voice answers. | What she heard and her answer appear as text in a bubble by the icon as soon as the answer is ready; speech follows. Tapping the icon stops the speech. The bubble closes 5 s after speech ends; tapping it opens the chat. |
| CK-4 | Tap to type. | A tap opens a chat sheet: the conversation so far, a text field, and sources under each answer (web links open in the browser). Typed questions get text answers and no speech. |
| CK-5 | A non-hold way to speak. | The chat sheet has a mic button: tap to start, tap to stop (NFR-9, APP-6: nothing needs a long press). VoiceOver labels on the icon, mic and every bubble. |
| CK-6 | First use and refusals. | The first hold asks for microphone permission, explaining why. If it is refused, holding shows how to turn it on, and typing still works. |
| CK-7 | Offline. | With no connection the icon is dimmed and says "You're offline" (OFF-2). Nothing is queued. |
| CK-8 | Not on the website. | The website has no Cookie button, chat or settings in this intent (owner, 2026-10-02: decided later). The API routes answer any signed-in session, as every `/api/v1` route does. The site keeps `microphone=()` in its Permissions-Policy. |

### 2.2 Voice and language (VOX)
| ID | Requirement | Acceptance criteria |
|---|---|---|
| VOX-1 | Mandarin, English and both mixed. | The clip goes to the model as audio with no language set, in one call that only writes down the words; the words then go through the same loop as a typed question (plan SP-C1). Spike SP-C1 passes before anything else is built: on 20 or more real questions from the family (English, Mandarin, mixed), every key term (names, places, sport terms, dates and numbers) is right in at least 18. |
| VOX-2 | The transcript is always shown. | Every voice turn returns `heard`, the words as spoken (Chinese in simplified characters, English as English, not translated). A wrong transcript can be fixed by typing the question. |
| VOX-3 | Names she should know. | The people's names from Settings → People, and the places the calendar names most often (street addresses left out), are given to the model as a short spelling list (40 names at most) so they are transcribed correctly. |
| VOX-4 | She answers in the language of the question. | English question, English answer; Mandarin, Mandarin; mixed, the main language of the question, keeping names and sport terms as they were said. |
| VOX-5 | Speech out. | The answer text is turned into speech on the server by a voice that reads Mandarin and English in one sentence (chosen in SP-C3). If that fails or the month's spend is at 80% of the cap, the phone's built-in voice reads it. Links aren't read out. "Spoken answers" can be switched off in Settings. |
| VOX-6 | Speed. | From release to the answer text: under 3 s for a question answered from the hub, on 4G with a warm backend (median, measured in SP-C1 and again before release). Speech starts within 2 s after that. |

### 2.3 Character and grounding (CHR)
| ID | Requirement | Acceptance criteria |
|---|---|---|
| CHR-1 | Concise. | Default answers are at most two sentences and about 40 words (or 60 Chinese characters), the answer first, no preamble and no offers of more help. "Tell me more" or a question that asks for a list lifts this to about 150 words. The output token cap enforces it (LIM-2). |
| CHR-2 | She barks when she doesn't know. | When the tools don't hold the answer, she answers with outcome `bark`: "Woof!" (or "汪！") plus one short line saying what she couldn't find. The app plays a bark sound, then reads the line. A bark never contains a guess or a "probably". |
| CHR-3 | Answers are checked against what ran. | Every answer lists its sources: `hub`, `memory`, `web`, `conversation` or `self`. The server turns the answer into a bark when it claims a source whose tool did not run in this question (or, for `conversation`, when there are no earlier turns). `self` is allowed only for greetings, who she is, sums, and translating or explaining a word. |
| CHR-4 | Sources are shown. | Hub answers name the area ("Calendar", "Tennis"). Web answers show the page title and link, and she says "from the web" in speech. |
| CHR-5 | Advice stays labelled. | Predictions, forecasts and video feedback are repeated as estimates or AI feedback, as the pages label them (0001 constraints). |
| CHR-6 | Read-only. | No tool changes hub data. Asked to move, add, delete, enter or refresh something, she says she can't do that yet and where to do it. Not a bark. |
| CHR-7 | Safe to hear. | The children will hear her. She never reads out credentials, tokens or sign-in codes (no tool returns them: CSEC-5), and keeps answers suitable for a child. |

### 2.4 What she knows: tools (TOOL)
Cookie has exactly these tools. Adding one is a spec change.

| ID | Tool | Reads | Returns |
|---|---|---|---|
| TOOL-1 | `today()` | The Today view (`loadToday`). | What's next, today's events, clashes this week, school days, things waiting on the owner. |
| TOOL-2 | `calendar(from, to, person?, category?, text?)` | Calendar events, at most 31 days per call. | Up to 40 events: title, start, end, place, people, category, clash. |
| TOOL-3 | `tennis(view, player?, tournament?, season?)` | `upcoming`, `results`, `player`, `tournament`. | Tournaments and entries, draw and next opponent with win % (labelled estimate), results and W–L. |
| TOOL-4 | `swimming(view, event?, meet?)` | `meets`, `results`, `pbs`, `event`. | Meets and entries, results, personal bests, one event's progression and forecast (labelled estimate). |
| TOOL-5 | `school(date?, person?)` | School day and key dates. | Periods, rooms and teachers for a day; closures and key dates in the next 60 days. |
| TOOL-6 | `videos(sport?, id?)` | Video reviews. | The last 10 reviews (date, sport, note, status), or one review's points. |
| TOOL-7 | `costs()` | Costs summary. | Month to date, forecast, budgets, AI by feature. |
| TOOL-8 | `memory_search(keywords)` | Her memory. | Up to 8 matching facts with their IDs. |
| TOOL-9 | `memory_save(text, about?, keywords)` | Writes one fact. | The saved fact. Rules in MEM-1. |
| TOOL-10 | `memory_forget(id)` | Marks one fact forgotten. | The forgotten fact. |
| TOOL-11 | `web_search(query)` | Google Search, in a separate call (CSEC-3). | Nothing to the model: the search's own short answer, with up to 3 pages and the Google searches behind it as links, goes to the family word for word and ends the question (§4.7). No answer in the results: the model is told so and may bark. |
| TOOL-12 | `web_fetch(url)` | One public page whose link is written in the question. | Its title and text, up to 8,000 characters. Rules in CSEC-4. |
| TOOL-13 | `answer(heard, language, text, sources)` | Ends the question. | — |
| TOOL-14 | `bark(heard, language, text)` | Ends the question. | — |

| ID | Requirement | Acceptance criteria |
|---|---|---|
| TOOL-15 | Narrow inputs, capped outputs. | Each tool has a zod schema for its input and output. Results are compact JSON (no IDs the model doesn't need, no nulls), cut at 6,000 characters with `more: true`. A unit test fails if the system prompt plus all tool definitions grow past 12,000 characters (10,000 until she learned to add an event in intent 0008; 8,000 until the memory tools were added in K3: the seven hub tools and the prompt alone came to 7,400). |
| TOOL-16 | Every person, not only Jayden. | Calendar and school tools take any person from Settings → People. Tennis and swimming hold the primary person's data today, and say so when asked about someone else. |
| TOOL-17 | Hub and memory first. | The prompt orders the tools: hub, then memory, then the web. The web is used only when those can't answer or the question asks for it, and only if "Use the web" is on in Settings. While it is off, the web tools and the prompt's paragraph about them aren't sent to the model at all. |
| TOOL-18 | What every question starts with. | The date and time in the home time zone, the people's names, and the VOX-3 spelling list. Nothing else from the hub is sent unless a tool is called. |

### 2.5 Memory (MEM)
| ID | Requirement | Acceptance criteria |
|---|---|---|
| MEM-1 | Saved only when told. | `memory_save` runs only when the question asks her to remember something: the server checks the question's own words for "remember", "记住" and the like, so text in a tool result can never start a save. It also refuses a save in a question where a web tool has already run. One fact per question, at most 300 characters, with search keywords in both languages. |
| MEM-2 | She confirms. | The answer repeats what was saved in one line. The chat shows "Saved to memory" with Undo for 10 s. |
| MEM-3 | Found across languages. | A fact saved in English is found by a Mandarin question and the reverse: search matches the fact's text and its bilingual keywords. The eval set (§4.6) has cases for both directions. |
| MEM-4 | Visible and editable. | Settings → Cookie → Memory in the app: each fact with who saved it and when; add, edit, forget. Forgotten facts can be restored for 30 days, then are deleted for good. |
| MEM-5 | Forget by voice. | "Cookie, forget …" finds the fact, forgets it and says which one. If more than one matches, she asks which. As with saving, the server checks that the question's own words ask for it, and one fact per question. |
| MEM-6 | No secrets. | She refuses to remember passwords, card numbers and sign-in codes, and the Memory screen says not to store them. The server refuses a fact that names one (password, passcode, PIN, 密码, 验证码 …) or holds a card-length number, by chat and by hand. |
| MEM-7 | One memory for the family. | Shared by every allow-listed account. |
| MEM-8 | Follow-ups. | Each question carries the text of up to 6 earlier turns from the same conversation in the last 30 minutes (at most 2,000 characters). Audio and tool results from earlier turns are never sent again. |
| MEM-9 | History. | The chat shows past turns, newest last. "Clear history" in Settings removes the text of every turn. Turn text is removed automatically after 90 days; token and cost numbers stay for the Costs page. |

### 2.6 Limits and cost (LIM)
| ID | Requirement | Acceptance criteria |
|---|---|---|
| LIM-1 | A hard stop per question. | At most 4 model rounds and 5 tool calls, of which at most 1 `web_search` and 1 `web_fetch`. On reaching a limit without an answer, the outcome is a bark. A model call is given 12 s and one retry, and a question 25 s in all; past that she says she can't answer right now (outcome `error`, not a bark). |
| LIM-2 | Small outputs. | Output capped at 500 tokens; the model's thinking set to its lowest setting that passes the eval set. |
| LIM-3 | Small inputs. | Clips at most 30 s and 1 MB, AAC in an MPEG-4 file (what the iPhone records); anything else is refused before any model is called. Typed questions at most 500 characters. |
| LIM-4 | Rate limits. | 20 questions per 5 minutes per account and 300 a day for the family, counted with the existing rate limiter. Over the limit: "Cookie needs a rest. Try again in a few minutes." |
| LIM-5 | Monthly cap. | A cap in Settings → Cookie (default US$10). At the cap she answers "Cookie has reached this month's limit" until the month ends or the cap is raised. Spoken answers fall back to the phone's voice at 80%. |
| LIM-6 | Every question is costed. | Each turn records model, tokens in and out, audio seconds, speech characters, searches and an estimated cost. Costs → AI by feature shows "Cookie" per day and this month (COST-4). |

### 2.7 Security and privacy (CSEC)
| ID | Requirement | Acceptance criteria |
|---|---|---|
| CSEC-1 | Signed-in only. | Every assistant route needs a session or device token (AUTH-2, API-2). The route-list e2e covers them. |
| CSEC-2 | Audio is not kept. | The clip lives in memory on the phone (or a protected temporary file deleted once sent or cancelled) and in memory on the server for the length of the request. Never written to storage, the database or logs. Speech audio is made on request and not stored. |
| CSEC-3 | Web searches carry no family details. | `web_search` is its own model call that receives only the query: no conversation, no hub data, no memory. Queries are at most 120 characters. The server refuses a query containing a person's name from People (always, listed or not) or any word on the "Never send to the web" list in Settings → Cookie (the owner adds the school, street and clubs). Google keeps queries for up to three days, not tied to the account (§4.7). |
| CSEC-4 | Page fetches are fenced in. | `web_fetch` opens only a link written in the question itself: never one from a search result (Google's terms forbid it, §4.7), a page's text or any other tool result. HTTPS on its usual port, a named public site (no bare addresses, no sign-in details in the link); the host must resolve to public addresses only (no private, loopback, link-local, carrier-NAT or metadata addresses), checked when the connection is made so the address checked is the address used, and again on each of at most 3 redirects; 5 s; 1 MB; HTML or plain text only; no cookies or hub headers. Scripts are not run. One page per question. |
| CSEC-5 | No credentials. | No tool reads the credential or session tables. An integration test runs every hub tool against a seeded database and checks that no credential, token or email-inbox text appears in any result. |
| CSEC-6 | Tool results can't give orders. | Tool results are passed as data in function responses, and the prompt says text inside them is never an instruction. Because she is read-only, the only things a planted instruction could try are a memory save (blocked by MEM-1) and a web request carrying hub data (blocked by CSEC-3 and CSEC-4). Tests cover both with a hostile page and a hostile event title. |
| CSEC-7 | Logs hold no words. | Logs record the turn ID, outcome, tool names, timings and token counts. Never the question, answer, transcript, memory text or audio. |
| CSEC-8 | On the phone. | Nothing from Cookie is cached on the phone: history is fetched when the chat opens. Sign-out needs no extra wipe (SEC-3). |

---

## 3. Services

| Job | Service | Why |
|---|---|---|
| Understand the clip and answer | `gemini-3.8-flash` on Vertex AI, from `global` (spike SP-6 of 0001 found it generally available there). Model ID in `ASSISTANT_MODEL`. | Takes audio directly and handles mixed Mandarin and English without a language setting. A first call writes down what was said; the answer loop then runs on those words (SP-C1: the transcript is then always there, and voice takes the path the eval set covers). Same project, bill and service-account sign-in as the video reviews. |
| Fallback transcription | Google Cloud Speech-to-Text (Chirp), in front of the same model. | Not needed: SP-C1 passed on Gemini's transcripts. |
| Speech out | Google Cloud Text-to-Speech, a Chirp 3 HD voice (SP-C3; the speaker's name in `ASSISTANT_VOICE`): its Mandarin voice for Chinese and mixed answers, its English voice for English ones. MP3, about 20 kB an answer, made in about a second. Fallback: the iPhone's `AVSpeechSynthesizer`. | The phone's voices are free but switch badly between languages mid-sentence. The first million characters a month are free, then US$30 per million; each answer read is counted at the list price against Cookie's cap. |
| Web search | Vertex AI's Grounding with Google Search, in a separate call (CSEC-3). | No new account or key. The first 5,000 searches a month are free, then US$14 per 1,000; a question can make 1–4 searches. Each is counted at the list price against Cookie's cap. |
| Page fetch | A small fetcher in the web service (`node:https` with a guarded DNS lookup), using the HTML parser the scrapers already use. | The hub had no general page fetcher, so this is new code. |
| Memory | Two new tables in the hub's Postgres. | A family's facts are tens to a few hundred rows: keyword search is enough, no vector database. |

Not chosen: Claude (no audio input, and its Vertex quota is still 0);
Gemini Live (speech-to-speech streaming: dearer per minute and more to
build than press-and-hold needs); Apple's on-device dictation (one
language at a time).

**Cost, measured (SP-C2 and the eval set, 2026-10-02).** A typed hub
question used about 3,100 tokens in and 85 out over two rounds: about
US$0.0027 at the Flash list price (US$0.75 per million tokens in, text
or audio, and US$3.75 out). Audio adds about 25 tokens a second, so a
10 s spoken question adds a fiftieth of a cent. At 30 questions a day
that is about US$2.40 a month before speech, under the US$10 default
cap. The list price doubles on 2027-01-01 (`pricing.ts` knows the date).
Search grounding is free for the first 5,000 queries a month, then
US$14 per 1,000. A spoken question adds the transcription call (about
150 tokens in, 15 out: two hundredths of a cent). A spoken answer of 80
characters is US$0.0024 at the list price, though a family stays far
inside the free million characters a month.

---

## 4. Design

### 4.1 One question, end to end
```
 iPhone: hold → record (AAC, 16 kHz mono) → release
        │  POST /api/v1/assistant/ask { conversationId, audio | text }
        ▼
 web service: limits (LIM-4/5) → build context (TOOL-18, MEM-8)
        │
        ▼  (a clip only)
 Gemini Flash: the clip → the words (`heard`), with the spelling list
        │
        ▼
 Gemini Flash ── tool call ──► hub loaders / memory / web   (≤ 4 rounds)
        │   ◄── tool result ──
        ▼
 answer(...) or bark(...) → grounding check (CHR-3) → save turn + cost
        │  { turnId, heard, outcome, text, sources, saved? }
        ▼
 iPhone: show text → GET …/turns/{id}/speech → play
```

- **Forced tool calls.** The model must always call a tool, and
  `answer` and `bark` are the two that end the loop. That gives a
  structured result (transcript, language, text, sources) without
  depending on JSON output and tool calling working together (SP-C2).
- **Text first, speech second.** The ask route returns as soon as the
  answer exists. The app then asks for the speech, so the words are on
  screen while the audio is being made.

### 4.2 Backend
- `src/server/assistant/`: `model.ts` (Gemini tool loop with audio in,
  sharing Vertex set-up and `pricing.ts` with `src/server/llm/`),
  `scripted.ts` (a scripted model for tests and `ASSISTANT_LLM=fake`),
  `prompt.ts`, `tools/` (one file per tool: schema, run, shape),
  `ground.ts` (CHR-3), `limits.ts`, `memory.ts`, `web.ts` (search call,
  query filter, guarded fetch), `speech.ts`, `ask.ts` (the loop).
  `src/domain/assistant.ts` holds the pure rules (grounding, limits,
  query filter, address checks) for unit tests.
- Runs in the web service, not the worker: a question is one request of
  a few seconds. Speech and search need the Text-to-Speech API enabled
  and no new secrets.

### 4.3 API (all under `/api/v1/assistant`, documented in `openapi.json`)
| Route | Does |
|---|---|
| `POST /ask` | `{ conversationId?, text? , audio?: { data, mimeType } }` → `{ turnId, conversationId, heard, language, outcome, text, sources, saved, forgot }` (`saved` and `forgot` are the fact this question saved or forgot, or null). Audio is base64 in JSON, so the generated client needs nothing special. |
| `GET /turns/{id}/speech` | The answer as audio (`audio/mpeg`). 404 for someone else's turn or cleared text; 409 when spoken answers are off or the spend is at 80% of the cap; 503 when the voice doesn't answer. On anything but audio the app uses the phone's voice. |
| `GET /turns`, `DELETE /turns` | History, newest last, paged. Clear history. |
| `GET /memories`, `POST /memories` | List (with forgotten ones on request), add. |
| `PATCH /memories/{id}`, `DELETE /memories/{id}`, `POST /memories/{id}/restore` | Edit, forget, restore. |
| `GET /settings`, `PATCH /settings` | Monthly cap, spoken answers, use the web, "never send to the web" words; the GET also gives this month's spend. |

### 4.4 Data
- `assistant_turns`: conversation ID, user, mode (voice or text), heard,
  answer, outcome (`answer`, `bark`, `limit`, `error`), language,
  sources, tools used (names, sizes and timings only), model and
  version, tokens in and out, audio seconds, speech characters,
  searches, cost, created at, text cleared at.
- `assistant_memories`: text, keywords, about (people IDs), created and
  updated by and at, how it was saved (voice, chat or settings),
  forgotten at.
- Settings key `assistant` for §4.3's settings.
- The daily sync run (`sync all`) clears turn text after 90 days and
  deletes memories forgotten more than 30 days ago, next to the
  notification clean-up. No new scheduled job.

### 4.5 Clients
- **iPhone.** `HubKit/Assistant/`: client, types and the voice rules
  (tested on the Mac). `HubApp/Features/Cookie/`: the recorder
  (AVFoundation, started off the main thread) and the speaker, the
  floating button as an overlay in `RootView`, the bubble, the chat
  sheet, and Settings → Cookie (Memory, History, Spoken answers, Use
  the web, cap). `NSMicrophoneUsageDescription` in `project.yml`. No
  bark sound in the asset catalogue until the owner supplies one (K-8):
  the voice says "Woof!". No new packages (SEC-4).
- **Web.** No chat on the website (CK-8). The Costs page shows Cookie's
  cost line, as it does for every AI feature.

### 4.6 Tests
- Unit: grounding check, limits, query filter, address checks, prompt
  size (TOOL-15), turn shaping for each tool.
- Integration (scripted model, real database): the loop for each tool,
  bark on unknown, bark on an ungrounded claim, limit reached, memory
  rules (MEM-1), CSEC-5 and CSEC-6 cases, costs recorded, cap and rate
  limits.
- e2e (`ASSISTANT_LLM=fake`): the API through the built server: ask,
  history, settings and memory routes; signed-out 401 for each route.
- iPhone: HubKit tests against recorded responses; a UI test for tap,
  type, answer, and for the mic button with a fixture clip injected by a
  debug flag.
- **Eval set** (`pnpm assistant:eval`, real model, seed data, run by
  hand before release and whenever the prompt or model changes): about
  40 typed questions in English, Mandarin and mixed. Pass: every
  question the seed data can't answer gets a bark (no made-up answer),
  at least 90% of answerable ones are right, and no answer exceeds
  CHR-1. Results are pasted into the plan.

### 4.7 Google's terms for search grounding (read 2026-10-02)

The Service Specific Terms for "Grounding with Google Search" shape the
web tools more than the first draft of this spec allowed for:

- **Shown as it is.** A result may not be modified or mixed with other
  content. So a search ends the question: its answer goes to the family
  word for word and is never handed back to Cookie's model to rephrase
  or combine with hub data.
- **With its links and search suggestions**, to the person who asked.
  The answer carries its pages and the Google searches behind it as
  links (K-12).
- **Links are not for software to follow.** Using a result's links to
  find pages to crawl is forbidden, so `web_fetch` never opens one; it
  reads only links the family typed (CSEC-4).
- **Stored only as chat history.** Results may be kept in the asker's
  chat history (up to two years; the hub keeps turn text 90 days) and
  not otherwise cached, analysed or learned from. Nothing from the web
  goes into memory (MEM-1), and tool results are never stored.
- **No click tracking.** The app opens links in the browser and records
  nothing about it.
- **Google's side.** Queries are stored for up to three days for
  debugging, not associated with the customer or its users.

---

## 5. Concerns

| # | Concern | Handling | Owner decision? |
|---|---|---|---|
| K-1 | **Children's voices leave Canada for processing.** `gemini-3.8-flash` answers from `global`, as the video model does. The owner accepted that for video and text; voice clips are a new kind of data. | Nothing is stored (CSEC-2). SP-C2 checks whether a Canadian region serves the model with audio. | **Decided 2026-10-02:** accepted. Voice clips are processed outside Canada; nothing is stored. |
| K-2 | **Google may keep web search queries.** Search grounding has its own data terms, which SP-C4 reads before it is switched on. | SP-C4 read the terms (2026-10-02, §4.7): Google keeps the queries for up to three days for debugging, not tied to the account or its users. The search call sees only the query, with family words refused (CSEC-3). "Use the web" can be off. | **Decided 2026-10-02:** off by default. |
| K-3 | **Mixed-language transcripts may not be good enough.** | SP-C1 is first and has a pass bar. Fallback: Chirp in front. If both fail, the feature ships typing-first and voice waits. | No |
| K-4 | **She may still make something up.** A model can call a tool and then misread it. CHR-3 catches claims with no source, not wrong readings of a real one. | Short answers, sources shown, the eval set's bark cases, and the transcript on screen. Reported mistakes become eval cases. | No |
| K-5 | **What may she answer from her own knowledge?** A strict reading of "grounded" means even "what's 12 × 12" needs a source. | Default: `self` only for greetings, who she is, sums and word help (CHR-3). Facts about the world need the web or get a bark. | **Decided 2026-10-02:** the default stands. |
| K-6 | **Costs and other grown-up answers said aloud** in front of the children (intent question 4). | Default: she answers what she is asked. A "don't say aloud" list of tools (e.g. costs: text only) is small to add. | **Decided 2026-10-02:** nothing held back. |
| K-7 | **Memory recall by keywords** may miss a fact worded differently. | Bilingual keywords at save time (MEM-3), eval cases. If recall is poor, add embeddings in a later intent. | No |
| K-8 | **The bark sound.** A stock sound needs a licence that allows it. | Default: the owner records the real Cookie (plan O-4). Until then the voice says "Woof!". | **Decided 2026-10-02:** the voice says "Woof!" until a recording is supplied. |
| K-9 | **The website and the app drift apart** (N-1 of 0004): Cookie is the first feature only the app has. | Owner's choice (2026-10-02). The backend is client-neutral, so a website chat later needs no server change. | **Decided 2026-10-02:** app only for now. |
| K-10 | **A floating button covers content.** | Sits above the tab bar; hidden over the video player. Position and dragging are intent question 3. | **Decided 2026-10-02:** fixed bottom-right, not draggable. |
| K-11 | **She is slower than VOX-6 asks.** Measured from the owner's Mac (plan, Spikes): a model call takes 1–4 s even for a trivial question, a hub question needs two, and the median was 4.7 s against the 3 s target. Now and then a call stalls. | Thinking is off, calls time out at 12 s, and `today()` answers most questions in one lookup. Measured again from Cloud Run in K7.1. If it stays slow: show "Cookie is looking…" with the tool's name, and consider a second, smaller model for the first round. | **Decided 2026-10-02:** the speed is acceptable. Still measured from Cloud Run in K7.1. |
| K-12 | **A search's answer is Google's, not Cookie's.** By Google's terms it is shown as it is, so it isn't in her voice, isn't held to two sentences by her own rules (the search is asked for two), and isn't checked by CHR-3. It can be wrong. Also: the terms want Google's "search suggestions" shown with a result. The app shows them as plain links to the Google searches, not Google's own chip design; whether that is enough is not confirmed. | Web answers are marked "From the web" with their pages; nothing from the web can be saved to memory (MEM-1). "Use the web" is off by default. | Yes: before switching the web on, accept this, or ask for Google's chip design to be embedded |

---

## 6. Defaults taken for the intent's open questions

1. Changing things: no, read-only (CHR-6). A later intent.
2. Learning on her own: no, only when told (MEM-1).
3. The icon: every screen except sign-in, lock and the full-screen
   player; not draggable (CK-1).
4. Things not to say aloud: none yet (K-6).
5. The website: no Cookie there for now (owner, 2026-10-02; CK-8).
6. History: text kept 90 days, then cleared; can be cleared any time
   (MEM-9). Memory is kept until forgotten.
7. Voice and bark: a plain friendly voice, "Leda", until the owner has
   listened to the SP-C3 samples and picked one; the bark is a
   recording of Cookie if the owner supplies one (K-8).
