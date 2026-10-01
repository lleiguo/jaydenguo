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
