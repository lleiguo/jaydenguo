# Plan: Review the whole video
Status: draft (2026-10-11), with [spec.md](spec.md).

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

## 3. Milestones
| # | What | Spec | PR |
|---|---|---|---|
| V1 | Worker: 10-minute cap, separate Gemini clip and playback copy, 900-frame budget; web form text. | WVR-1..4, WVR-5 (web), WVR-6 | |
| V2 | iPhone form text; TestFlight bump. | WVR-5 (iPhone) | |

## 4. Done when
- The 4-minute swim from 2026-10-11 is reviewed whole after "Try again",
  and its player plays all 4 minutes with the cited times lined up.

## 5. Status
Draft. Waiting on the owner's approval of intent, spec and plan.
