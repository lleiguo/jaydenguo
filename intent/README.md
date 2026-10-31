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
| 0011 | [Past suggestions clear, skipped events hide](0011-tidy-lists/) | approved 2026-10-03 (chat); defaults kept | approved 2026-10-03 (chat) | approved 2026-10-03; T1 merged and deployed (#97), build 10 (#98) awaits upload |
| 0012 | [Pull down to refresh his tennis entries](0012-tennis-pull-refresh/) | approved 2026-10-09 (chat); defaults kept, Refresh button stays | approved 2026-10-09 (chat); P-1, P-2 accepted | approved 2026-10-09; P1 next |
| 0013 | [One event per lesson, however many emails](0013-email-duplicates/) | approved 2026-10-11 (chat); defaults kept | approved 2026-10-11 (chat) | approved 2026-10-11; D1, D2 merged and deployed (#109, #110); TestFlight build 11 uploaded |
| 0014 | [Review the whole video](0014-whole-video-review/) | approved 2026-10-11 (chat); defaults kept | approved 2026-10-11 (chat); W-1..W-3 accepted | approved 2026-10-11; V1 built |
| 0015 | [His tests and homework from Google Classroom](0015-school-classwork/) | approved 2026-10-12 (chat); server sign-in, defaults kept | approved 2026-10-12 (chat) | approved 2026-10-12; CW1 next |
| 0016 | [A smaller image registry bill](0016-registry-cleanup/) | approved 2026-10-12 (chat) | approved 2026-10-12 (chat) | approved 2026-10-12; R1 merged and deployed (#135), old versions deleted; Terraform apply waits on the owner |
| 0017 | ["Accepted" once he's in the main draw](0017-tennis-accepted/) | approved 2026-10-16 (chat); defaults kept | approved 2026-10-16 (chat); A-1, A-2 accepted | approved 2026-10-16; A1, A2 merged and deployed (#138, #139, #141); TestFlight build 15 uploaded; Terraform apply waits on the owner |
| 0018 | [The saved calendar first, on any connection](0018-calendar-cache-first/) | approved 2026-10-16 (chat); defaults kept | approved 2026-10-16 (chat); S-1, S-2 accepted | approved 2026-10-16; S1 merged (#144), on TestFlight in build 17; the owner's phone check (O-1) left |
| 0019 | [Cookie reads a screenshot or pasted text](0019-cookie-reads-screenshots/) | approved 2026-10-17 (chat); defaults kept | approved 2026-10-17 (chat); S-1..S-4 accepted | approved 2026-10-17; S1–S3 merged (#148–#150), S1 deployed; build 17 (#151) waits on the owner's Xcode sign-in |
| 0020 | [One family calendar, both ways](0020-household-two-way/) | approved 2026-10-17 (chat); defaults kept | approved 2026-10-17 (chat); T-1..T-6 accepted | approved 2026-10-17; H1–H5 built; Terraform apply (O-3) waits on owner |
| 0021 | [School stays out of the household calendar](0021-household-no-school/) | approved 2026-10-18 (chat); defaults kept | approved 2026-10-18 (chat); N-1 accepted | approved 2026-10-18; NO1 in #161 |
| 0022 | [Delete any calendar event](0022-delete-any-event/) | approved 2026-10-18 (chat); defaults kept | approved 2026-10-18 (chat); D-1..D-3 accepted | approved 2026-10-18; DL1, DL2 merged (#164, #165); TestFlight build 19 uploaded |
| 0023 | [A push for each step of tennis and swimming, every suggestion and clash](0023-push-notifications/) | approved 2026-10-19 (chat); defaults kept | approved 2026-10-19 (chat); N-1..N-3 accepted | approved 2026-10-19; P0–P2 merged and deployed (#169, #170), build 20 uploaded; APNs key in, test push arrived (NTF-1) |
| 0024 | [An event belongs to whoever it names, else whoever made it](0024-default-owner/) | approved 2026-10-24 (chat); defaults kept | approved 2026-10-24 (chat); C-1..C-3 accepted | approved 2026-10-24; OW1 next |
| 0025 | [Today's mail, summarized and read aloud](0025-reading-digest/) | approved 2026-10-25 (chat); defaults kept | approved 2026-10-25 (chat); M-1..M-6 accepted | approved 2026-10-25; MD1–MD3 merged and deployed (#186, #188, #190); TestFlight build 24 uploaded; Terraform apply (O-3) waits on the owner; MD4 next |
| 0026 | [Full-screen video and follow-up questions on a review](0026-video-full-screen-follow-ups/) | approved 2026-10-27 (chat); defaults kept | approved 2026-10-27 (chat); Q-1..Q-5 accepted | approved 2026-10-27; FQ1–FQ4 merged and deployed (#199–#202); TestFlight build 27 uploaded |
| 0027 | [Tell me when to leave, and when I'm running late, from live traffic](0027-traffic-late-alerts/) | approved 2026-10-27 (chat); defaults kept | approved 2026-10-27 (chat); T-1..T-5 accepted | approved 2026-10-27; TL1–TL4 merged and deployed (#207–#209); TestFlight build 28 uploaded; Terraform apply (O-2) waits on the owner |
| 0028 | [Green ball tournaments count for Jayden](0028-tennis-green-ball/) | approved 2026-10-30 (chat); defaults kept | approved 2026-10-30 (chat); G-1..G-3 accepted | approved 2026-10-30; G1 merged and deployed (#214); the owner's production check left |
| 0029 | [U12 green events count for Jayden](0029-tennis-u12-green/) | approved 2026-10-31 (chat); defaults kept | approved 2026-10-31 (chat); U-1..U-3 accepted | approved 2026-10-31; U1 next |
