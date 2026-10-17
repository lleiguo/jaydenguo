# Plan: Cookie reads a screenshot or pasted text
Status: approved (owner, 2026-10-17, in chat), with [spec.md](spec.md).

Order: the server first (the API, the model call, several adds), so the
eval can try made-up screenshots before any app work; then her chat; then
the share sheet and a TestFlight build.

## 1. What the owner does
| # | Step | Needed for |
|---|---|---|
| O-1 | Approve intent, spec and plan; answer the intent's questions 1–4 and S-4 if the defaults aren't right. | everything |
| O-2 | Install the TestFlight build after S3. Share a real WhatsApp message and a screenshot to Cookie, one "Add to calendar" and one "Summarize". | Done when |
| O-3 | Try sharing from WeChat (SP-S1 on your phone, with your account). | S-3 |

## 2. Spikes
| # | Question | How | Blocks |
|---|---|---|---|
| SP-S1 | What do WhatsApp and WeChat hand the share sheet: text, an image, or nothing? | On the simulator for WhatsApp's text share where possible; on the owner's phone for WeChat (O-3). | SHR-1 wording, S-3 |
| SP-S2 | How long does a question with 3 screenshots take, and does 40 s hold? | Time 5 made-up cases against Vertex from the eval script. | SHA-6 |
| SP-S3 | Is a 2,048 px JPEG enough to read a full-screen chat screenshot, or does a long (scrolling) one need tiling? | Eval with tall made-up screenshots at 1,536 and 2,048 px. | SHT-2 |

## 3. Milestones
| # | What | Spec | PR |
|---|---|---|---|
| S1 | **Server.** `images` and `pasted` on the ask input, sizes and types checked; the material as its own parts with the marker line; the prompt paragraph; web tools off; up to 5 adds and the 40 s / 8-call limits; `shared` on turns and the migration; OpenAPI. Integration tests and the eval cases (SP-S2, SP-S3). | SHT-2..4, SHA-1..7, SHSEC-1..4, §3.1–3.4 | 1 |
| S2 | **Her chat.** Photo button, paste of images and long text, thumbnails and the text attachment, `shared` shown in history; HubKit request, shrinker and turn field. UI tests. | SHT-1..5, §3.5 | 1 |
| S3 | **"Ask Cookie" in the share sheet.** The new extension target, the sheet with its three choices, the answer and cards with Undo, offline and errors. Checked by hand on the simulator with Photos and Notes. | SHR-1..6 | 1 |
| S4 | **Release.** `CURRENT_PROJECT_VERSION` 17 in its own PR; archive and upload to TestFlight. | — | 1 |

## 4. Done when
- In the app, a screenshot of a made-up practice change with "add this"
  adds that event with its card and Undo; with no words she summarizes
  and asks "Add it to the calendar?".
- A long pasted schedule (over 500 characters) is accepted and adds up to
  5 events in one answer.
- From Photos, "Ask Cookie" → Add to calendar adds the event without
  leaving the share sheet.
- No question's image or pasted text is in the database or the logs.
- The owner has tried it on real messages (O-2).

## 5. Status
| Task | Status |
|---|---|
| O-1 | done 2026-10-17: approved, defaults kept. |
| S1 | merged 2026-10-17 (#148). |
| S2 | built 2026-10-17 on `ios/0019-s2-chat` (below). |
| SP-S2, SP-S3 | done 2026-10-17 (below). |
| S3 | built 2026-10-17 on `ios/0019-s3-share` (below). |
| S4 | next. |

**As built (S1, 2026-10-17):**
- *API.* `POST /assistant/ask` takes `images` (1–3 JPEGs, 1 MB each,
  checked by their first bytes) or `pasted` (up to 8,000 characters), with
  or without `text` or `audio`; the body limit is 6 MB. Turns carry
  `shared` (`{ kind, count }`); migration `0034_assistant_turn_shared`.
  An answer from the material has the source "What you shared", kind
  `self` with `shared: true`, so older app builds read it.
- *Rules.* Up to 5 `calendar_add` per question with something shared, 8
  tool calls, 20 s a round, 40 s in all; web tools not offered. "All day"
  is taken from a picture or a paste that says it. "Everyone" must be
  the parent's own word. A model failure after an add now answers with
  what was added (every question, not only shared ones).
- *Prompt.* `cookie-4`: a paragraph sent only with something shared;
  the budget is 15,000 characters (spec §1).
- *Tests.* Unit (`assistant-shared.test.ts`: input, picture checks,
  labels, grounding, limits, the fence), integration (12: one and five
  adds, an owner missing, two hostile pastes, no web tools, pictures and
  history, the claim without material, the failure after adds,
  everyone), e2e (paste and pictures through the API, refusals, nothing
  kept).
- *SP-S2, SP-S3 (eval, `pnpm assistant:shared-eval`, 14 made-up cases).*
  Of the cases Vertex AI answered, all passed: the WhatsApp-style
  practice (added, Sat Nov 7 9:00–10:30), its summary and "what should he
  bring?", the Chinese notice (added at 10:00, summary in Chinese), six
  games (five added, the sixth named), the poster (she asks whose it is),
  the hostile message (summarized, nothing added), no text (nothing
  added), a full 1170×2532 screenshot at both 2,048 and 1,536 px (added at
  8:15), a 614-character paste (three lessons added) and a Chinese paste.
  Median 5 s, slowest 44 s with Vertex busy; US$0.004 per case. Vertex
  AI was answering 429 and timing out for text-only questions too that
  morning; the eval tries a case three times before counting it as "no
  reply". The hostile picture sometimes gets no reply (Gemini stops at
  `MAX_TOKENS` with nothing): she says she can't answer right now and
  nothing changes. 1,536 px reads a full screenshot as well as 2,048; the
  phone keeps 2,048 (SHT-2).

**As built (S2, 2026-10-17):**
- *Chat.* A + button left of the microphone: Choose Photos (the system
  picker, 3 at most) or Paste (a picture, or text: over 500 characters it
  becomes an attachment, otherwise it goes in the field). Typing past 500
  characters moves the text out of the field too. Thumbnails, or the
  paste's first line, show above the field with a remove button; the
  field says "Add this, summarize… (optional)". A spoken question takes
  the attachment with it (SHT-5).
- *HubKit.* `CookieAttachment`, `CookieImage.jpeg` (ImageIO: decoded at
  2,048 px straight from the file, quality lowered to fit 1 MB, smaller if
  it still doesn't; shared with S3), `CookieChat.body`, and history that
  shows "add this · 2 screenshots" and "From what you shared".
- *Tests.* HubKit `CookieShareTests` (7: shrinking a 1290×2796 picture,
  the body, the rules, history); UI `testALongPasteIsSharedNotAsked`,
  `testAScreenshotIsSentWithTheQuestion` (with `-HubCookiePicture`, debug
  builds only: XCUITest can't drive the out-of-process Photos picker); all
  13 Cookie UI tests pass on the iPhone 18 Pro simulator, iOS 27.

**As built (S3, 2026-10-17):**
- *Extension.* A second share extension, `HubAskShare`, "Ask Cookie"
  (`com.jaydenguo.hub.askcookie`), shown for 1–3 pictures or text. It
  shrinks each picture as it reads it (`CookieImage.jpeg`), shows the
  pictures or the text's first lines, then Add to calendar, Summarize and
  "Ask something else" (SHR-2, SHR-3: the buttons send "Add this to the
  calendar" or "Summarize this", "加到日历" / "总结一下" on a phone in
  Chinese). Her answer, its source and any events added show in the sheet,
  with Undo while it's offered (SHR-4); offline and errors as SHR-6.
- *Found.* iOS 27's share sheet lists the app as "Hub", not each
  extension's name: a picture opens "Ask Cookie" from there (Review in Hub
  doesn't take pictures).
- *Tests.* UI `AskCookieShareTests`: Photos → Share → Hub → Summarize →
  her answer "From what you shared" (stand-in model), on the iPhone 18
  Pro simulator, iOS 27. SP-S1 (what WhatsApp and WeChat hand the share
  sheet) needs the owner's phone (O-3).
