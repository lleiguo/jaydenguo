# Spec: video reviews by Gemini alone
Source: [intent.md](intent.md). Status: built from the owner's request
(2026-10-01, in chat). The owner chose to drop the debate's columns (G-1)
the same day; G-2 is for the owner to act on.

Replaces 0001 VID-3a to VID-3e and the rounds in §6.3 (two reviews, blind
critiques and scores, replies, final scores, verdict, combined advice,
the parent's vote, the scoreboard and the review mode setting). Changes
0004 IVID-1 (the app shows the same) and 0005 SPT-2 and SPT-6 (no
Claude-only mode, no vote to clear). VID-1, VID-2, VID-3, VID-4, VID-5,
playback (0003) and the sport (0005) stay as they are.

Claude is still used for email suggestions (EML-2) and tennis prediction
explanations (TEN-6). Nothing about those changes.

## Requirements
| ID | Requirement | Acceptance |
|---|---|---|
| GEM-1 | Gemini reviews every video, alone. | A review is one Gemini call with the clip (plus one to work out the sport when asked, 0005). The page shows that review as "The review". There is no review mode to choose. |
| GEM-2 | The debate is gone from the site and the app. | No verdict, vote, scoreboard, review mode setting, or "both reviews, scores and replies" section on the web or in the iPhone app. No "agreed" or "disputed" labels on points. History rows show the status only. The "review ready" notification names the video, not a winner. |
| GEM-3 | The debate is gone from the API. | Removed: `POST /api/v1/videos/{id}/vote`, `GET /api/v1/videos/scoreboard`, `PATCH /api/v1/videos/settings`. `GET /api/v1/videos/settings` answers only whether Google Drive and Photos are connected. Review summaries lose `mode`, `winner`, `tie` and `parentVote`; details lose `verdict` and `votedAt`; rounds lose `labels` and `scores`. |
| GEM-4 | Older two-model reviews stay in the history. | They show the advice they ended with, like any other review. Retrying one, or reviewing it again for another sport, runs it with Gemini. |
| GEM-5 | The debate's data is deleted. | The columns that held the review mode, the verdict, the vote, and a round's blind labels and scores are dropped. |

## Design
- `runReview` (`src/server/video/reviewer.ts`) replaces the debate: one
  call, stored as a `review` round, retried once on a malformed answer.
- The worker no longer extracts still frames (they were only for Claude).
  The Claude client keeps text requests only.
- The review prompt is unchanged, so the prompt version stays
  `video-1-draft`.
- Database: one migration (0025) drops `video_reviews.mode`, `verdict`,
  `parent_vote` and `voted_at`, and `video_review_rounds.labels` and
  `scores`. The rounds of older two-model reviews stay as rows (their
  cost still counts on the costs page), so the checks on a round's `round`
  and `model` still allow the debate's values.

## Cost
About $0.15 a video, instead of $1.50 to $2 for a debate.

## Concerns
| # | Concern | Handling |
|---|---|---|
| G-1 | Dropping the debate's columns deletes what older two-model reviews stored in them (verdicts, votes, judges' scores), and can't be undone except from a database backup. | The owner chose to drop them (2026-10-01). |
| G-3 | The deploy migrates the database before the web service is updated, and the old web code reads the dropped columns. | The Videos pages and API fail for the minute or two between the two deploy steps. Accepted; nothing is lost. |
| G-2 | The API change isn't additive (0004 API-6). An installed app built before this change can't read the new video list, so its Videos screens fail until it's updated. The rest of the app is unaffected. | Install a build made from this change before deploying the server: the new app works against both the old and the new server. |
