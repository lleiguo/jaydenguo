# Plan: the right sport for a video review
Source: [spec.md](spec.md). Status: approved (2026-09-30).

| Task | Description | Spec | Done when |
|---|---|---|---|
| S.1 | `sport_source`, `superseded_at`, the `detect` round (migration). | SPT-4, SPT-6, SPT-7 | Migration merged. |
| S.2 | Detection in the worker: prompt, schema, fake answer, "not sure" handling; costs from all rounds. | SPT-2, SPT-3, SPT-7 | Integration tests: detected, not sure, failed detection, owner's change skips it. |
| S.3 | `sport: "auto"` on create; `PATCH /api/v1/videos/{id}`; review again from the playback copy; retry keeps earlier rounds. | SPT-1, SPT-5, SPT-6 | Integration tests: each status, review again with and without a copy, the vote cleared, costs kept. |
| S.4 | Web: "Detect automatically" on the form; the sport control and confirmation on the review page; "(detected)" and "Sport not set" in the history. | SPT-1, SPT-4..6 | e2e: change the label of a finished review. |
| S.5 | iPhone: the same on the New review sheet and the review screen. | SPT-1, SPT-4..6 | UI test: change the label and change it back. |

## Status
| Task | Status |
|---|---|
| S.1–S.5 | done: merged in #56 and deployed (2026-09-30). Migration 0022. Retry now keeps a failed attempt's rounds (superseded) instead of deleting them, so the costs page counts them. |
