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
- Start a new folder from [`_template/`](_template/), following [new-intent](../.claude/skills/new-intent/SKILL.md).
- Every PR's description has an `Intent:` line: `Intent: NNNN` (one or more, comma-separated), or `Intent: none — <reason>` for a fix or chore that doesn't touch `db/schema/`, `db/migrations/` or `infra/`. CI (PR gates / intent) fails code PRs whose intent, spec or plan isn't approved; a PR that only changes `intent/` passes while still in draft (intent 0010).

| # | Change | Intent | Spec | Plan |
|---|---|---|---|---|
| 0001 | [Jayden hub](0001-jayden-hub/) | approved 2026-09-26 | approved 2026-09-26 | approved 2026-09-26; M0–M6 merged and deployed, open items in the plan's Status |
| 0002 | [Costs dashboard](0002-costs-dashboard/) | approved 2026-09-28 (chat) | approved 2026-09-28 (merged, #38) | approved 2026-09-28; done, merged in #38 |
| 0003 | [Video playback](0003-video-playback/) | approved 2026-09-28 (chat) | approved 2026-09-28 (merged, #40) | approved 2026-09-28; done, deployed |
| 0004 | [iPhone app](0004-ios-app/) | approved 2026-09-28 (chat) | approved 2026-09-28 (chat) | approved 2026-09-28; N0–N8 merged (#45–#61), on-phone checks in the plan's Status |
| 0005 | [Video sport](0005-video-sport/) | approved 2026-09-30 (chat) | approved 2026-09-30 (chat) | approved 2026-09-30; done, merged in #56 |
| 0006 | [Video reviews by Gemini alone](0006-video-gemini-only/) | approved 2026-10-01 (chat) | built from the request 2026-10-01; concerns G-1, G-2 for the owner | built 2026-10-01 |
| 0007 | [Cookie, the family assistant](0007-cookie-assistant/) | approved 2026-10-02 (chat); defaults kept | approved 2026-10-02 (chat); owner decisions recorded in §5; K-12 open | approved 2026-10-02; K1–K6 merged, K7 built except the owner's steps (Terraform, TestFlight, a few days' use): see the plan's Status |
| 0008 | [Cookie changes the calendar](0008-cookie-calendar-changes/) | approved 2026-10-02 (chat); the household Google Calendar | approved 2026-10-02 (chat); E-1..E-6 decided in §5 | approved 2026-10-02; E1–E5 merged and deployed (#82–#84); owner's steps (TestFlight build 7, the Google grant, Gmail) in the plan's Status |
| 0009 | [Cookie reads an email when asked](0009-cookie-reads-email/) | approved 2026-10-03 (chat); fetched when asked, nothing kept; defaults kept | approved 2026-10-03 (chat); R-1..R-3 accepted | approved 2026-10-03; R1–R4 built, not merged; SP-R2 after deploy |
| 0010 | [The workflow, written into the repo and enforced](0010-codified-workflow/) | approved 2026-10-03 (chat); defaults kept | approved 2026-10-03 (chat); W-1..W-4 accepted | approved 2026-10-03; W1–W6 done (#92–#94); O-2 denylist secret left |
