# Intent: The workflow, written into the repo and enforced
Status: draft (2026-10-03). Drafted by Claude from the owner's request.
Owner: Jayden's parent (lleiguo).

"What would be the best way to codify the workflow and make sure Claude
or any other coding agent always respects it?"

## Problem
The way changes are made here is written in prose, in four places, and
only CI enforces any of it:

- `intent/README.md` and `CLAUDE.md` hold the intent → spec → plan rules,
  the commands, the migration rule and "no secrets or real personal data".
  `AGENTS.md`, which agents other than Claude read, holds only the Next.js
  note.
- The ship routine (docs approval, then build → PR → CI → merge → deploy →
  production test → TestFlight) and "run `format:check` and
  `openapi --check` before pushing" live only in Claude's private memory
  on the owner's Mac. Another agent, or Claude on the web, never sees
  them.
- Nothing runs before a push. PRs #48, #55 and #87 each needed a
  follow-up commit for a check CI caught after the push.
- Nothing checks that a code change has an approved intent. GitHub branch
  protection isn't available on a private repo on the free plan, so
  nothing stops a PR with failing checks from being merged either.

An agent follows the workflow only as long as it reads the right file and
remembers it. Which agent is working, and on which machine, shouldn't
matter.

## Proposed outcome
- **One written workflow, in the repo.** Every agent and every machine
  reads the same rules: the docs approval, the ship routine, the checks
  before pushing, what needs an intent and what doesn't.
- **One command for the checks.** An agent runs one command before
  pushing, and it matches what CI runs.
- **The rules that can be checked are checked by machines, not memory.**
  Before a push, before a merge, when a PR is opened.
- **The longer routines are on hand as procedures** (starting an intent,
  shipping), so an agent follows the same steps every time.
- **Claude's private memory stops being where the workflow lives.** It
  keeps only what is about this Mac.

## Constraints
- No new paid services by default. GitHub Pro (for branch protection) is
  the owner's call (question 1).
- No slowdown that makes agents skip the checks: the check before a push
  should take about two minutes at most.
- Works in the shared checkout and in worktrees, on the Mac and on Claude
  Code on the web.
- Small fixes (a form message, an icon, a build number) keep moving
  without a new intent (question 2).

## Open questions (defaults in brackets)
1. Pay for GitHub Pro (about $4 a month) to get branch protection, so a
   red PR can't be merged and `main` can't be pushed to directly? [No.
   The pre-push hook, Claude's merge hook and CI cover it, though a
   person or agent could still bypass them on purpose.]
2. Which changes may skip an intent? [Fixes and chores, if the PR says
   `Intent: none` with a reason, and the change doesn't touch the
   database schema or `infra/`. Those need an intent.]
3. Should the ship routine's standing permission (merge, deploy and push
   TestFlight without asking) apply to every agent, not just Claude?
   [Yes: it describes how this repo ships, not who ships it.]
4. Scan for real personal data (names of Jayden's teammates, coaches,
   schools) in CI, using a list kept as a GitHub secret? [Yes; the list
   never goes in the repo.]
