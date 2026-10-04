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
Approved 2026-10-03. **W1–W6 done**: docs #92, W1–W3 #93, W4–W5 #94
(merged 2026-10-04); W6 is in Claude's local memory.

- **SP-W1:** `pnpm verify` takes 37 s on the owner's Mac, so the
  pre-push hook runs all of it.
- **SP-W2:** a fresh Claude session in a worktree from `main` had its
  `--no-verify` command blocked by the guard hook. Claude Code on the web
  isn't checked yet; it loads the same `.claude/settings.json`.
- **First live runs:** the pre-push hook refused two of Claude's own
  pushes for #93 (a failing test, then a type error) before CI saw them.
  The PR gates passed on #94.
- **Incident while building:** a hook test that ran inside pre-push
  inherited git's `GIT_DIR`. Its scratch `git init` marked the shared
  repository bare for about two minutes, breaking git in every worktree
  until it was reset. The tests now drop `GIT_*` variables (#93).
- **Departures from the spec:**
  - The migration rule (GH-4) is a `commit-msg` hook, since it reads the
    message.
  - VER-3 also covers ESLint and `tsc`.
  - CCH-3 also blocks `git commit -n` and `core.hooksPath` changes.
  - The PR gates are a separate workflow that also runs on `edited`.
  - Older intents' status comes from the README table.
  - gitleaks is a pinned release with its checksum checked, not the
    gitleaks GitHub Action.
- **Owner:** add the `PERSONAL_DATA_DENYLIST` secret (O-2). Leave out
  "Jayden". `brew install gitleaks` (O-3) is optional.
