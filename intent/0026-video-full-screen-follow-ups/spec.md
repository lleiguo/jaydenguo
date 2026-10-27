# Spec: Full-screen video and follow-up questions on a review
Status: draft (2026-10-27). Written by Claude from [intent.md](intent.md).

Read with 0001 (VID-3, VID-4, §6.3), 0003 (PLAY-1..8), 0004 (IVID-2),
0005 (SPT-6), 0006, 0014 (WVR-2, WVR-3) and 0002 (costs).
IDs here: FS (full screen), ASK (follow-up questions), ASKSEC (security).

## 1. What changes in earlier specs
- **0003 PLAY-1/PLAY-2** The playback copy is also the video Gemini watches
  for a question. It stays private and in the same bucket.
- **0003 PLAY-4/PLAY-5** Times in answers are jump buttons and strip
  markers, like the review's points.
- **0003 PLAY-7** Deleting the video also ends questions on that review;
  the questions and answers already asked stay.
- **0004 IVID-2** The iPhone player gains a full-screen view (FS-1..4).
- **0001 VID-4** Deleting a review hides its questions with it; restoring
  brings them back.
- **0001 §6.3 rounds** A new stored round, `question`, so the costs page
  counts each question with its review.
- **0005 SPT-6, 0014 WVR-2** Unchanged; the question job makes its Gemini
  clip from the playback copy the same way a review re-run does.

## 2. Requirements

### 2.1 Full screen in the app (FS)
| ID | Requirement | Acceptance criteria |
|---|---|---|
| FS-1 | A button opens the player full screen. | A "Full screen" button (arrows icon, labelled for VoiceOver) on the review page's player opens a full-screen view with the same player: it doesn't download again, and it keeps the time, speed and play/pause state. |
| FS-2 | It fills the screen both ways. | The video fills the screen, aspect fit on black, upright or sideways, following the phone. The status bar and the tab bar are hidden. |
| FS-3 | The tools stay. | The full-screen view has play/pause, 0.25×, 0.5× and 1×, one frame back and forward, the strip of points (PLAY-4) and the current point (PLAY-5). Tapping the video hides and shows them; they hide by themselves after 3 s of playing. |
| FS-4 | Closing returns to the review. | A close button and a swipe down close it. The review page's player is at the same time and speed. The page's own orientation rules (landscape allowed on this screen only) are unchanged. |

### 2.2 Follow-up questions (ASK)
| ID | Requirement | Acceptance criteria |
|---|---|---|
| ASK-1 | Ask about a finished review. | A done review with a playback copy shows "Ask about this video" under the review, on the website and in the app: a text box (1–500 characters) and Ask. Reviews that aren't done, or have no copy (PLAY-7, PLAY-8), show no box; one without a copy says "The video was deleted, so no more questions can be asked." |
| ASK-2 | Gemini answers from the video. | The answer comes from Gemini (the review's model, 0006) with the video, the sport and its rubric, the parent's note, the review, and the earlier questions and answers of this review in order. It's a few sentences, plus up to 5 points with a time ("m:ss", on the clip's clock, PLAY-6). If something can't be seen in the video, it says so. Framed for his age, as AI feedback (VID-3). |
| ASK-3 | Questions run in the background. | Asking saves the question and starts a job; the page shows "Answering…" and updates by itself (web polling as the review does; app refresh). One question at a time per review: the box is disabled while one is answering. A question usually answers in under 2 minutes. |
| ASK-4 | A thread per review. | Questions and answers show under the review, oldest first, with their date. Each answer's times are jump buttons, and its points are markers on the strip (shown differently from the review's), like PLAY-4/5. |
| ASK-5 | Failures can be retried. | A failed question shows the reason (the review's failure messages) and "Try again", which asks it again. A failed question doesn't count towards the limit. |
| ASK-6 | At most 10 answered questions per review. | The 11th is refused with "This review has had 10 questions. Start a new review to ask more." |
| ASK-7 | Costs count. | Each question's Gemini call is stored as a `question` round of the review, so the costs page counts it with videos (0002). The question shows its own cost under the answer, like the review. |
| ASK-8 | Cookie sees the thread. | Cookie's videos tool (TOOL-6) returns a review's questions and answers with its points. Cookie still can't ask new ones. |
| ASK-9 | The note says it can be a question. | The web and iPhone forms label the note "Note or question (what to look at)", e.g. "review his forehand technique". Behaviour unchanged. |

### 2.3 Security (ASKSEC)
| ID | Requirement | Acceptance criteria |
|---|---|---|
| ASKSEC-1 | Signed-in only. | The question routes use the site's own auth (AUTH-2) and the device token, like the other video routes. A question on another review's id, a deleted review or a missing one gives 404. |
| ASKSEC-2 | The question is data. | The prompt quotes the question as the parent's words; it can't change the instructions or the answer's shape (schema-checked). Questions and answers aren't logged, only ids, status and cost. |

## 3. Design
- **Data.** New table `video_questions`: `id`, `review_id` (→
  `video_reviews`), `question` (≤500), `status` (`queued`, `answering`,
  `done`, `failed`), `answer` (jsonb), `error_message`, `cost_usd`,
  `created_at`, `finished_at`; index on (`review_id`, `created_at`).
  `REVIEW_ROUNDS` gains `question`; the round's check constraint changes
  (a migration from `pnpm db:generate`). The round row stores the
  question's id in its output for the costs breakdown.
- **Answer schema** (`prompts.ts`): `{ answer: string, points: [{ text,
  at, good }] (0..5) }`. `followUpPrompt(context, review, thread,
  question)`; the version is stored with the round.
- **API.** `POST /api/v1/videos/{id}/questions` `{ question }` → 202 with
  the question (409 while one is answering, 409 at the limit, 404/409 when
  the review isn't done or has no copy). `POST
  /api/v1/videos/{id}/questions/{qid}/retry` → 202. `GET
  /api/v1/videos/{id}` returns `questions` (and `canAsk`). OpenAPI and the
  HubKit types and fixtures follow.
- **Job** `video:question <qid>` (`src/worker/video/question.ts`): reads
  the playback copy, makes the Gemini clip with `prepareMedia` as the
  re-run path does (SPT-6), calls Gemini once (invalid output asked again
  once, like the review), saves the answer, the round and the cost. Temp
  files deleted at the end. A question stuck `answering` for 30 minutes
  (the worker's timeout) shows as failed.
- **Web.** `review-view.tsx`: the thread and the ask box under the
  advice; answer points go to `review-player.tsx`'s strip.
- **iPhone.** `ClipPlayer` stays the one player. A `FullScreenPlayer`
  view shown with `fullScreenCover`, with an `AVPlayerLayer`-backed view
  (not `VideoPlayer`, whose controls can't hold ours) and the existing
  `PointStrip`. `VideoDetailScreen` gains the thread and the ask box.
- No Terraform or new cloud resources.

## 4. Testing
- Unit: the answer schema and prompt (quotes the question, includes the
  thread in order); the limit and one-at-a-time rules; answer points on
  the strip.
- Integration (fake Gemini, local media store): ask → job → answer saved,
  round stored with cost; retry after a failure; 404 for a deleted
  review; 409 with no copy, while answering, and at 10.
- E2E (web): ask on a done review, see "Answering…", then the answer with
  a jump button that seeks the player.
- iPhone UI test: open full screen, step a frame, change speed, close,
  same time on the page; ask a question against the fake server.
- Production: the owner asks one question on a real review, on the phone,
  and opens full screen sideways.

## 5. Concerns for the owner
| # | Concern | Recommendation |
|---|---|---|
| Q-1 | Each question costs about as much as the review (Gemini watches the whole reviewed part again), up to 10 per review. | Accept; the costs page shows it. Mark a short part when making the review if you plan many questions. |
| Q-2 | An answer may disagree with the review. | Accept; the answer stands under the review, the review isn't changed (intent question 3). |
| Q-3 | Older reviews from before 0014 have a 2-minute copy, and reviews with the video deleted can't be asked about. | Accept; make a new review for those. |
| Q-4 | Our own full-screen controls mean the system's Picture in Picture and AirPlay buttons aren't there. | Accept; neither is used today. |
