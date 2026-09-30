# Spec: the right sport for a video review
Source: [intent.md](intent.md). Status: approved (owner, 2026-09-30, in chat).

Changes 0001 VID-1 (the sport is no longer only chosen on the form) and
VID-3d (a vote goes with the review it judged), and 0004 IVID-1, IVID-3
and EXT-3 (the app offers the same). The sport matters for more than the
label: it picks the checklist the models review against (§6.3 rubric) and
Gemini's frame rate.

## Requirements
| ID | Requirement | Acceptance |
|---|---|---|
| SPT-1 | "Detect automatically" is a sport choice, and the default. | The web form and the app's New review sheet list it first and start on it. Choosing a sport still works as before. A YouTube link can't be watched by the site (F-3), so there it's saved as "Other" and marked "not set". |
| SPT-2 | The job works out the sport before the review. | After the video is prepared and before round 1, one model call looks at it and names the sport: Gemini with the clip at 1 frame a second, or Claude with the frames in Claude-only mode. It's stored as a round (`detect`) with its cost. The page shows "Working out the sport" meanwhile. The review then uses that sport's checklist. |
| SPT-3 | An unsure answer doesn't guess. | If the model isn't sure, or the call fails, the review carries on as "Other" and is marked "not sure". The review page asks the owner to set the sport. A failed detection never fails the review. |
| SPT-4 | Where a sport came from is shown. | Every review is "chosen", "detecting", "detected" or "not sure". The history and the review page show "(detected)" after a detected sport and "Sport not set" for one it wasn't sure of. |
| SPT-5 | The sport can be changed. | The review page (web and app) has a sport control. The new sport is "chosen". Before the review starts (queued or waiting for a Photos pick), a change just replaces the sport, and detection is skipped. While the review is running, changes are refused ("Change the sport when the review has finished"). A failed or saved review just takes the new sport. |
| SPT-6 | A finished review can be run again for the new sport. | Changing the sport of a finished review asks: "Review again as <sport>" or "Only change the label". Review again runs the whole review again (in the current review mode) from the playback copy, so nothing is fetched or picked again. Without a copy, a Drive video is fetched again and a Photos video is picked again. The earlier rounds are kept for the costs page but no longer shown. The parent's vote went with the earlier reviews, so it's cleared; the confirmation says so. Only change the label keeps the review and the vote, and the scoreboard counts it under the new sport. |
| SPT-7 | Costs add up. | A review's cost is every model call made for it, including detection and earlier runs. The costs page counts every call (retries included). |

## Design
- `video_reviews.sport_source`: `chosen` (default, and every existing
  review), `detecting`, `detected`, `unsure`. While detecting, `sport` is
  `other`.
- `video_review_rounds.superseded_at`: set on the rounds of an earlier
  run (review again, and now retry too, which used to delete them and so
  dropped their cost from the costs page). The review page reads only the
  current rounds; the costs page reads all. The `detect` round joins the
  round list.
- `POST /api/v1/videos` takes `sport: "auto"`. The summary gains
  `sportSource`.
- `PATCH /api/v1/videos/{id}` with `{ sport, reviewAgain }` (default
  false). 409 while running.
- The worker re-reads the sport after preparing the media, so a change
  made while the owner was picking in Photos counts. With a playback copy
  and `reviewAgain`, the copy is the source: it's already the segment, so
  no segment is applied, and it isn't saved again.
- Detection prompt: the sports the site knows, and "other" for anything
  else; answer `{ sport, sure, reason }`.

## Cost
One call per detected review: a few thousand tokens of video at 1 frame a
second, about a cent with Gemini. A review again costs a whole review.

## Concerns
| # | Concern | Handling |
|---|---|---|
| S-1 | A wrong but confident detection gives a review for the wrong sport. | The detected sport is marked, and review again fixes it for the cost of a review. |
| S-2 | Clearing the vote on a review again goes against "the vote is never overwritten" (VID-3d). | The vote judged reviews that are replaced. It isn't changed, only removed with them, and the owner is told first. |
