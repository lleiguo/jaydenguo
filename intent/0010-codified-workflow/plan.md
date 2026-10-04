# Plan: The workflow, written into the repo and enforced
Status: approved (owner, 2026-10-03, in chat), with [spec.md](spec.md).

Order: the written workflow and the check command first (useful on their
own), then the local hooks, then the CI gates, which only make sense once
PRs have an `Intent:` line to check.

## 1. What the owner does

| # | Step | Needed for |
|---|---|---|
| O-1 | Answer intent questions 1–4, or keep the defaults. | everything |
| O-2 | Add the GitHub secret `PERSONAL_DATA_DENYLIST` (one name per line), if question 4 stays yes. | W4 |
| O-3 | Optional: `brew install gitleaks`, so commits are checked locally too (GH-4). | W2 |

## 2. Spikes

| # | Question | How | Blocks |
|---|---|---|---|
| SP-W1 | How long does `pnpm verify` take on the Mac with a warm cache? | Time three runs. If it's over 2 minutes, restrict the pre-push run to the changed files (VER-4). | W2 |
| SP-W2 | Do Claude Code hooks in `.claude/settings.json` fire the same in a `.claude/worktrees` worktree, a scratchpad worktree and on the web? | Run a hook that logs once from each. | W3 |

## 3. Milestones

| # | What | Spec | PR |
|---|---|---|---|
| W1 | `AGENTS.md` workflow section; `CLAUDE.md` trimmed; `pnpm verify` and `verify:full`; `.prettierignore` fix; CI uses `pnpm verify`. | WF-1..4, VER-1..5 | 1 |
| W2 | `.githooks/` (pre-push, pre-commit) and the `prepare` script. | GH-1..5 | 1 |
| W3 | Claude Code hooks and their shell tests. | CCH-1..5 | 1 |
| W4 | `check-intent.mjs` and `check-personal-data.mjs` with tests; `intent` and `secrets` CI jobs. | CIG-1..7, WSEC-2 | 2 |
| W5 | `intent/_template/`; the `new-intent` and `ship` skills; README row. | PRO-1..3, WSEC-3 | 2 |
| W6 | Replace the two memory files with pointers; update this plan's Status. | §1 | none (memory is local) |

PR 1 is W1–W3: local only, nothing in CI can fail yet because of it. PR 2
is W4–W5, opened with `Intent: 0010` once this spec is approved.

## 4. Done when
- An agent other than Claude, given only the repo, would find the
  workflow in `AGENTS.md`.
- A push with a Prettier or openapi mismatch is refused locally.
- A PR without an `Intent:` line, or naming a draft spec, fails CI.
- Claude can't `gh pr merge` a PR whose checks aren't green.

## 5. Status
Approved 2026-10-03.

- **SP-W1 done:** `pnpm verify` takes 37 s on the owner's Mac, so the
  pre-push hook runs all of it (no changed-files mode).
- **W1–W3 built** (PR 1). Departures from the spec:
  - The migration rule (GH-4) runs in a `commit-msg` hook, not
    `pre-commit`, because it reads the commit message.
  - VER-3 also covers ESLint and `tsc`: local build output and
    `.claude/worktrees` are ignored there too, not just in Prettier.
  - CCH-3 also blocks `git commit -n`, and changing `core.hooksPath`
    from the shell.
- **W1–W3:** PR #93.
- **W4–W5 built** (PR 2). Departures from the spec:
  - The intent and secrets gates are a separate workflow, "PR gates",
    not jobs in CI. That way editing a PR description re-runs only the
    gates (CI doesn't run on `edited`). Deploy still waits only for CI
    on `main`; the gates guard the merge (Claude's merge hook needs every
    check green).
  - Intents from before 0010 have no `Status:` line in their spec and
    plan, so the gate reads those from the README table.
  - gitleaks is downloaded from its release (pinned, checksum checked),
    not taken from the gitleaks GitHub Action.
- **O-2 note:** the denylist should hold names that must never appear,
  like teammates, coaches, schools and Jayden's brother. "Jayden" itself
  is in the repo's name and in code, so listing it would fail every PR.
- **SP-W2:** checked after PR 1 merges.
- **Next:** W6 (memory to pointers) after both PRs merge.
