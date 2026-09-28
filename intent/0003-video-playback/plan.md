# Plan: watch the video alongside its review
Source: [spec.md](spec.md). Status: draft (2026-09-28).

| Task | Description | Spec | Done when |
|---|---|---|---|
| P.1 | `video_reviews.playback_key`, `playback_bytes` (migration 0017). | PLAY-1 | Migration merged. |
| P.2 | Media store: Cloud Storage JSON API or local folder; `put`, `get` with range, `delete` (`src/server/video/media-store.ts`). Range parsing in `src/domain/byte-range.ts`. | PLAY-2, PLAY-8 | Unit tests for range parsing. |
| P.3 | Worker saves the clip after a successful review. Claude's frame labels use the clip's clock. | PLAY-1, PLAY-6 | Integration test: copy saved on success, not on failure; the review still finishes if saving fails. |
| P.4 | `GET`/`DELETE /api/v1/videos/{id}/video`. | PLAY-2, PLAY-7 | e2e: 206 for a range, 404 after delete; the route-list e2e proves 401 signed out. |
| P.5 | Player on the review page: markers, jump buttons, following, speed and frame step, delete video. | PLAY-3..5, PLAY-7 | e2e: a jump button seeks the video and the point shows under it. |
| P.6 | Terraform: `media` bucket, IAM, `MEDIA_BUCKET` env. | PLAY-2 | `terraform validate`; owner applies. |

## Status
| Task | Status |
|---|---|
| P.1–P.6 | built on `video/playback` (2026-09-28), not merged; P.6 needs `terraform apply` |
