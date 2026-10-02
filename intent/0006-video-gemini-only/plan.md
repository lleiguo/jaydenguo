# Plan: video reviews by Gemini alone
Source: [spec.md](spec.md). Status: built 2026-10-01.

| Task | Description | Spec | Done when |
|---|---|---|---|
| G.1 | Worker and server: one Gemini review; the debate, its prompts and schemas, frame extraction, the vote, the scoreboard and the mode setting removed. Migration dropping the debate's columns. | GEM-1, GEM-4, GEM-5 | Unit and integration tests pass. |
| G.2 | API and `openapi.json`: routes and fields removed. | GEM-3 | `pnpm openapi --check` passes; the contract e2e test passes. |
| G.3 | Web: Videos page, review page, history and compare page. | GEM-2 | e2e: a Drive video is reviewed and shows "The review". |
| G.4 | iPhone: Videos list, review screen; scoreboard and review mode screens removed; fixtures recorded again from the seed. | GEM-2 | HubKit tests pass; the app builds. |

## Status
| Task | Status |
|---|---|
| G.1–G.4 | built 2026-10-01. Migration 0026. Owner steps: install an app build made from this change before the server deploys (G-2). |
