# Intent

One folder per change, numbered in order: `NNNN-short-name/`.

Each folder holds:
- `intent.md`: what was asked for and why (written by the owner).
- `spec.md`: requirements, design and flagged concerns (written by Claude, approved by the owner).
- `plan.md`: how it will be built (added once the spec is approved).

Rules:
- The `Status:` line records draft or approved, with the date.
- New scope after approval gets a new folder, not an edit to an approved intent.
- Small corrections are edited in place. The commit message says what changed and why.
- When the build departs from the spec or plan, update that file in the same commit as the code.

| # | Change | Intent | Spec | Plan |
|---|---|---|---|---|
| 0001 | [Jayden hub](0001-jayden-hub/) | approved 2026-09-26 | approved 2026-09-26 | approved 2026-09-26; M0–M6 merged and deployed, open items in the plan's Status |
| 0002 | [Costs dashboard](0002-costs-dashboard/) | approved 2026-09-28 (chat) | approved 2026-09-28 (merged, #38) | approved 2026-09-28; done, merged in #38 |
| 0003 | [Video playback](0003-video-playback/) | approved 2026-09-28 (chat) | approved 2026-09-28 (merged, #40) | approved 2026-09-28; done, deployed |
| 0004 | [iPhone app](0004-ios-app/) | approved 2026-09-28 (chat) | approved 2026-09-28 (chat) | approved 2026-09-28; N0–N8 merged (#45–#61), on-phone checks in the plan's Status |
| 0005 | [Video sport](0005-video-sport/) | approved 2026-09-30 (chat) | approved 2026-09-30 (chat) | approved 2026-09-30; done, merged in #56 |
| 0006 | [Video reviews by Gemini alone](0006-video-gemini-only/) | approved 2026-10-01 (chat) | built from the request 2026-10-01; concerns G-1, G-2 for the owner | built 2026-10-01 |
| 0007 | [Cookie, the family assistant](0007-cookie-assistant/) | approved 2026-10-02 (chat); defaults kept | approved 2026-10-02 (chat); owner decisions recorded in §5; K-12 open | approved 2026-10-02; K1–K4 built, spikes and K5–K7 in the plan's Status |
| 0008 | [Cookie changes the calendar](0008-cookie-calendar-changes/) | draft 2026-10-02; owner chose the household Google Calendar | — | — |
