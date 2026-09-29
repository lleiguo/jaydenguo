# Spec: watch the video alongside its review
Source: [intent.md](intent.md). Status: approved (owner, 2026-09-28: merged in #40 and deployed).

Changes 0001 VID-2, §7.2 and the §11 assumption "nothing is kept
afterwards except the reviews": a small copy of the reviewed part is now
kept, until the owner deletes it.

## Requirements
| ID | Requirement | Acceptance |
|---|---|---|
| PLAY-1 | A finished review keeps a playback copy of the part that was reviewed. | It's the clip the job already makes for Gemini: the owner's segment (or the whole video, at most 2 minutes), H.264, no sound, 720p or 480p, under 19 MB. Nothing extra is re-encoded. Drive and Photos videos are handled the same way. The copy is saved only when the review succeeds. If saving it fails, the review still counts as done, and the page says there's no copy. Other temp files are still deleted when the job ends. |
| PLAY-2 | The copy is private. | It's stored in its own Cloud Storage bucket in Canada (NFR-1), with public access blocked, and no retention policy or soft delete, so a delete is final. The page streams it through the site's own signed-in API (AUTH-2), with `Cache-Control: private, no-store`. There are no signed or public links. |
| PLAY-3 | The review page has a player. | The player sits above the advice and has the browser's own controls (play, pause, seek), plus 0.25×, 0.5× and 1× speed and step-one-frame back and forward buttons. Seeking works (HTTP range requests). |
| PLAY-4 | Points are linked to the video. | Each point with a time is a button: pressing it pauses the video at that time and scrolls the player into view. The advice's points appear as markers on a strip under the video (fixes and good points look different; disputed points are marked). Points without a time stay in the list only. The two models' own reviews and the replies have the same jump buttons. |
| PLAY-5 | Points follow playback. | While the video plays or is paused, the point at the current time (from its time to 2 seconds after it, the latest one if several match) is shown under the player and highlighted in the list. |
| PLAY-6 | All cited times use the clip's clock. | 0:00 is the start of the reviewed part. Claude's frame labels change from the original video's clock to the clip's clock, so both models agree with each other and with the player. When a segment was reviewed, the page says the times count from the segment's start. Reviews made before this change may be off by the segment's start. |
| PLAY-7 | The owner can delete the copy. | "Delete video" (with a confirmation) deletes the copy for good and keeps the review. Deleting the review is still a soft delete (VID-4) and keeps the copy, so a restore brings the video back. |
| PLAY-8 | Older reviews and local use still work. | Reviews made before this change, and reviews whose copy was deleted, show the review without a player. Without a bucket (local development, tests), copies go to a local folder (`MEDIA_DIR`). With neither setting, no copy is kept. |

## Design
- `video_reviews` gets `playback_key` (the object name, or null) and
  `playback_bytes`.
- A small media store with two backends: Cloud Storage through its JSON
  API with the service identity (`MEDIA_BUCKET`), or a local folder
  (`MEDIA_DIR`). Both are used by the worker (to save) and the web service
  (to stream and delete). Objects are named `reviews/<review id>.mp4`.
- `GET /api/v1/videos/{id}/video` streams the copy and supports a single
  `Range: bytes=a-b`. `DELETE` on the same path deletes it.
- Terraform: the `media` bucket, `roles/storage.objectUser` on it for the
  worker and the web service, and `MEDIA_BUCKET` on both.
- The CSP needs no change: the video is same-origin (`default-src 'self'`
  covers media). The service worker passes it straight to the network.

## Cost
About 10 clips a month at up to 19 MB is under 2.5 GB a year, a few cents
a month for storage. Streaming goes through Cloud Run and Firebase Hosting,
and each view downloads the clip once.

## Concerns
| # | Concern | Handling |
|---|---|---|
| P-1 | This reverses a privacy decision in 0001. The copies show Jayden. | They're kept in the owner's own Google Cloud project in Canada, behind sign-in, with no public or signed links, and each one can be deleted. Only the reviewed part is kept, without sound. |
| P-2 | Firebase Hosting might not pass range requests through to Cloud Run. | Seeking still works if it doesn't: the clip is small and saved with `faststart`, so the browser downloads it whole. Checked in production 2026-09-28: seeking works. |
| P-3 | The model's time for a point can be a second or so out. | The markers show where the model looked. The frame-step buttons help find the exact moment. |
