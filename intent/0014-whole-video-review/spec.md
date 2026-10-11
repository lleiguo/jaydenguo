# Spec: Review the whole video
Status: approved (owner, 2026-10-11, in chat: "Approve, defaults"). Written by Claude from [intent.md](intent.md).

Read with 0001 (VID-2, plan M5.3), 0003 (PLAY-1, PLAY-6) and 0006.
IDs here: WVR (whole video review).

## 1. What changes in earlier specs
- **0001 plan M5.3** The optional segment is no longer needed for videos
  over 2 minutes. Without one, the whole video is reviewed, up to 10
  minutes (WVR-1).
- **0003 PLAY-1** The playback copy is no longer the clip sent to Gemini.
  It is the reviewed part at 720p (or the source's size if smaller),
  30 frames a second at most, no sound, with no 19 MB limit (WVR-3).
  PLAY-6 (times on the clip's clock) stays.
- **0006** Unchanged: Gemini alone reviews, inline.

## 2. Requirements
| ID | Requirement | Acceptance criteria |
|---|---|---|
| WVR-1 | No segment means the whole video. | A review with no segment reviews the whole video when it is 10 minutes or less. A longer one fails with "The video is N min long. Mark a part of 10 minutes or less to review." A marked segment over 10 minutes fails with "The part you marked is N min long. Mark a part of 10 minutes or less." Segments under 10 minutes work as now. |
| WVR-2 | Gemini gets a clip it takes inline. | The clip for Gemini is encoded at the highest rate any sport asks for at its length (`geminiFps` for tennis, so the sport can still be detected after), 720p, then 480p, then 360p if still over 19 MB. A 10-minute 1080p test video fits (SP-V1). |
| WVR-3 | The playback copy is the whole reviewed part. | Saved from its own encode (720p, ≤30 fps, H.264, no sound), only when the review succeeds, as now. Its length matches the Gemini clip to within 0.5 s, so cited times line up (PLAY-6). |
| WVR-4 | Up to 900 frames per review. | `geminiFps` keeps tennis at 8 and swimming at 4 a second at most, and at least 1, with at most 900 frames: 4 min → 3 a second, 10 min → 1. |
| WVR-5 | The forms say so. | The web form and the iPhone form say "Part to review (optional: the whole video if empty, up to 10 minutes)". |
| WVR-6 | Failed reviews can be retried. | "Try again" on a review that failed with the old 2-minute message reviews the whole video. If its Google Photos picker session has expired, the review shows a new picker link and the owner picks the video again. |

## 3. Design
- `src/worker/video/media.ts`: `MAX_REVIEW_SECONDS` = 600 with the new
  message; `prepareMedia` makes two files from the source in one ffmpeg
  run per output: the Gemini clip (WVR-2) and the playback copy (WVR-3).
  `PreparedMedia` gains `playback: Buffer`; `clip` stays the Gemini clip.
- `src/domain/video-fps.ts`: the budget goes from 400 to 900 frames;
  `clipFps` is the Gemini clip's rate.
- `src/worker/video/review.ts`: saves `media.playback` as the copy. A
  review re-run from its playback copy (SPT-6) re-encodes the Gemini clip
  from it.
- `review.ts`: a Photos review whose picker session is gone opens a new
  one (status back to picking) instead of failing.
- Forms: `new-video-form.tsx` and the iPhone new-review screen text.
  The iPhone change needs a TestFlight build.
- No schema, API or infra change.

## 4. Testing
- Unit: `reviewRange` (whole video, 10-minute cap, messages), `geminiFps`
  (900-frame budget); with ffmpeg, a 4-minute synthetic video gives a
  3-frames-a-second Gemini clip and a 30-frames-a-second playback copy of
  the same length.
- Integration (fake Google, fake Gemini): a retried Photos review whose
  picker session expired asks for a new pick and finishes.
- Production: the owner's 4-minute swim (IMG_7714.MOV) reviewed with
  "Try again".

## 5. Concerns for the owner
| # | Concern | Recommendation |
|---|---|---|
| W-1 | A long review costs more: up to about 900 frames instead of 400. | Accept; the costs page shows it per review. |
| W-2 | A 10-minute review takes longer: download, two encodes, Gemini. Likely 3–6 minutes. | Accept; the progress line says what it's doing. |
| W-3 | At 1 frame a second (10-minute videos), quick strokes are seen coarsely. | Accept; mark a part for a close look at a stroke. |
