# Plan: Full-screen video and follow-up questions on a review
Status: approved (owner, 2026-10-27, in chat: "Approve, defaults"), with [spec.md](spec.md).

Order: full screen first (app only, no server change, ships on its own),
then the questions' server side, then the web and iPhone screens.

## 1. What the owner does
| # | Step | Needed for |
|---|---|---|
| O-1 | Approve intent, spec and plan; answer the open questions or keep the defaults. | All |
| O-2 | Install the TestFlight build; open a review full screen, upright and sideways. | FQ1 done |
| O-3 | Ask one question on a real review, on the phone (once by voice) and the website. | FQ4 done |

## 2. Spikes
| # | Question | How | Blocks |
|---|---|---|---|
| SP-F1 | Does a 10-minute review's playback copy re-encode to a Gemini clip and get an answer in under 2 minutes? | Run the question job locally on a 10-minute test copy with real Gemini; note time and cost in this plan. | FQ2 |

## 3. Milestones
| # | What | Spec | PR |
|---|---|---|---|
| FQ1 | iPhone full-screen player (its TestFlight build is FQ4's, so the owner installs once). | FS-1..4 | #199 |
| FQ2 | The transcribe route, `video_questions` table, `question` round, prompt and schema, the job, the API, OpenAPI, Cookie's tool, the note's label on the web. | ASK-1..3, ASK-5..9, ASK-10 (route), ASKSEC | #200 |
| FQ3 | Web: the thread and the ask box, answer points on the strip. | ASK-1, ASK-3, ASK-4 | #201 |
| FQ4 | iPhone: the thread and the ask box, answer points in both players, the hold-to-talk mic, the note's label; TestFlight build. | ASK-1, ASK-3, ASK-4, ASK-9, ASK-10 | |

## 4. Done when
- The owner opens a review full screen on the phone, sideways, steps
  frames and closes back to the same moment.
- The owner asks a question on a real review and gets an answer with a
  time that jumps the player, on the website and on the phone.
- On the phone, a question spoken with the mic appears in the box and is
  answered.
- The costs page shows the question's cost with videos.

## 5. Status
Approved 2026-10-27. FQ1–FQ4 merged and deployed 2026-10-27 (#199–#202,
deploy of f66388f; migration 0041). FQ1's TestFlight build was folded into
FQ4's: build 27 (#203) uploaded to TestFlight 2026-10-27, after the owner
signed in to Xcode again.

Left: the owner's checks O-2 and O-3 (full screen on the phone; a real
question by voice and on the website), and SP-F1 (time and cost of a
question on a 10-minute review with real Gemini), measured on the first
real question.
