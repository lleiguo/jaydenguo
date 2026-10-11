# Plan: Review the whole video
Status: approved (owner, 2026-10-11, in chat: "Approve, defaults"), with [spec.md](spec.md).

Order: the worker first (it fixes the failed review), then the forms.

## 1. What the owner does
| # | Step | Needed for |
|---|---|---|
| O-1 | Approve these docs (and answer the open questions, or keep the defaults). | V1 |
| O-2 | Tap "Try again" on the 2026-10-11 swim review. | Done when |
| O-3 | Install the TestFlight build with the new form text. | V2 |

## 2. Spikes
| # | Question | How | Blocks |
|---|---|---|---|
| SP-V1 | Does a 10-minute 1080p video's Gemini clip fit in 19 MB at 1 fps, 480p? | Encode a synthetic 10-minute clip locally and measure. | V1 |

**SP-V1 (2026-10-11): yes, with a 360p step.** 600 frames of a 1080p test
pattern at 1 fps: with light noise, 3.1 MB at 480p (72 MB at 720p); with
heavy noise on every frame (a worst case), 27.5 MB at 480p and 2.5 MB at
360p. So the ladder is 720p, 480p, 360p.

## 3. Milestones
| # | What | Spec | PR |
|---|---|---|---|
| V1 | Worker: 10-minute cap, separate Gemini clip and playback copy, 900-frame budget, new pick when the session expired; web and iPhone form text. | WVR-1..6 | (this PR) |
| V2 | TestFlight bump for the iPhone form text. | WVR-5 (iPhone) | |

## 4. Done when
- The 4-minute swim from 2026-10-11 is reviewed whole after "Try again",
  and its player plays all 4 minutes with the cited times lined up.

## 5. Status
Approved 2026-10-11 with the defaults. SP-V1 done; V1 built (unit +
integration green).
