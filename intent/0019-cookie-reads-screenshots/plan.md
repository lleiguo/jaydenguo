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
Approved 2026-10-17. S1 next.
