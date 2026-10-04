# Spec: The workflow, written into the repo and enforced
Status: approved (owner, 2026-10-03, in chat: "approved"). Written by
Claude from [intent.md](intent.md), with its defaults; W-1..W-4 accepted
with the recommendations.

IDs here: WF (the written workflow), VER (the check command), GH (git
hooks), CCH (Claude Code hooks), CIG (CI gates), PRO (procedures), WSEC
(security).

## 1. What changes

- **`AGENTS.md`** gains the workflow (WF-1), below the Next.js block that
  `next dev` rewrites (it only replaces the text between its own
  markers).
- **`CLAUDE.md`** keeps `@AGENTS.md` and only notes that apply to Claude
  alone. The rules in its "Project notes" move to `AGENTS.md`.
- **`intent/README.md`** keeps the folder rules and the table, and gains
  templates (PRO-1) and the `Intent:` line (CIG-1).
- **Claude's memory** (on the owner's Mac): `jaydenguo-commit-push-pr` and
  `jaydenguo-format-check` are replaced by one-line pointers to
  `AGENTS.md`. Anything that is only about this Mac (Postgres on 5433,
  the pnpm path, the shared checkout) stays in memory.

## 2. Requirements

### 2.1 The written workflow (WF)
| ID | Requirement | Acceptance criteria |
|---|---|---|
| WF-1 | One place. | `AGENTS.md` has a "Workflow" section with the lifecycle (intent → spec → plan → approval → build → ship), what needs an intent (CIG-2), the checks before pushing (VER-1), the ship routine (PRO-2), the standing permissions, and what always needs the owner: Terraform apply, deleting anything, real-account production tests, anything outside the flow. |
| WF-2 | Says what enforces each rule. | Each rule names what checks it (a hook, CI, or "none: judgement"), so an agent knows which rules a machine will catch and which ones it has to remember. |
| WF-3 | Short. | The section stays under about 120 lines. Procedures live in PRO files and are linked, not copied. |
| WF-4 | Read by every agent. | Claude reads it through `@AGENTS.md`. Codex, Cursor and other agents read `AGENTS.md` themselves. |

### 2.2 The check command (VER)
| ID | Requirement | Acceptance criteria |
|---|---|---|
| VER-1 | One command. | `pnpm verify` runs `format:check`, `lint`, `typecheck`, `openapi --check` and `test`, in that order, and stops at the first failure. |
| VER-2 | Same as CI. | CI's first five check steps become `pnpm verify`, so the two can't drift apart. |
| VER-3 | Works locally. | `.prettierignore` gains `ios/build`, `ios/DerivedData` and `.claude/worktrees`, so `format:check` checks only repo files on the Mac (today it's flooded with build output). |
| VER-4 | Fast enough. | Two minutes at most on the owner's Mac with a warm cache (measured in SP-W1). If it takes longer, the pre-push hook runs only the checks for the files the push changes. |
| VER-5 | The slow suites stay in CI. | Integration, build and e2e aren't in `verify`. `pnpm verify:full` adds `test:int` when `DATABASE_URL` is set. |

### 2.3 Git hooks, for every agent and every person (GH)
| ID | Requirement | Acceptance criteria |
|---|---|---|
| GH-1 | Installed on install. | A `prepare` script sets `core.hooksPath=.githooks`, so `pnpm install` turns the hooks on in every clone and worktree. No new dependency. |
| GH-2 | Before a push. | `.githooks/pre-push` runs `pnpm verify` and refuses the push if it fails. |
| GH-3 | No pushes to main. | The pre-push hook refuses a push whose target is `refs/heads/main`. Changes reach `main` only by merging a PR. |
| GH-4 | Before a commit. | `.githooks/pre-commit` refuses a change to `db/migrations/*.sql` unless `db/schema/` changed in the same commit or the commit message says it came from `pnpm db:generate`. It also runs gitleaks on the staged files if gitleaks is installed (CI always runs it, CIG-4). |
| GH-5 | Bypass is visible. | `--no-verify` still works, since git allows it. WF-1 says agents never use it, CCH-3 blocks it for Claude, and CI catches what it would have caught. |

### 2.4 Claude Code hooks (CCH)
In `.claude/settings.json`, checked in. Scripts in `.claude/hooks/`.
| ID | Requirement | Acceptance criteria |
|---|---|---|
| CCH-1 | Format on write. | After Edit or Write, Prettier formats the file if Prettier handles that file type. |
| CCH-2 | No hand edits to generated SQL. | Before Edit or Write to `db/migrations/**`, the tool call is blocked with "Edit db/schema/ and run pnpm db:generate". |
| CCH-3 | No bypass. | A Bash command containing `--no-verify`, or `git push` targeting `main`, is blocked with the reason. |
| CCH-4 | Merge only when green. | Before `gh pr merge <n>`: block the merge unless `gh pr checks <n>` shows every check passed. This stands in for branch protection for Claude (intent question 1). |
| CCH-5 | Quick. | Each hook takes under a second, except CCH-4, which makes one GitHub call. |

### 2.5 CI gates (CIG)
| ID | Requirement | Acceptance criteria |
|---|---|---|
| CIG-1 | The PR names its intent. | The PR description has a line `Intent: NNNN` (one or more, comma-separated) or `Intent: none — <reason>`. A new `intent` job on `pull_request` fails if the line is missing or malformed. |
| CIG-2 | Code needs an approved intent. | With `Intent: NNNN`: the folder `intent/NNNN-*` exists, and its `intent.md`, `spec.md` and `plan.md` each have a `Status:` line starting with `approved`. A PR that changes only `intent/**` (the docs for approval) passes with its own number while still in draft. |
| CIG-3 | What `none` can't cover. | `Intent: none` fails if the PR changes `db/schema/**`, `db/migrations/**` or `infra/**` (intent question 2). |
| CIG-4 | Secrets. | A `secrets` job runs gitleaks on the PR's commits and fails if it finds anything. |
| CIG-5 | Personal data. | If the secret `PERSONAL_DATA_DENYLIST` is set, the job also fails when an added line contains a listed name, case-insensitively. The list is never printed. The log names only the file and line (intent question 4). |
| CIG-6 | Plan drift, as a warning. | A PR with `Intent: NNNN` that changes `src/**` or `ios/**` but not that intent's `plan.md` gets a warning annotation, not a failure. |
| CIG-7 | Required in practice. | Deploy already waits for CI on `main`. The new jobs are part of the CI workflow, so a red gate means no deploy. |

### 2.6 Procedures (PRO)
Project skills under `.claude/skills/`. `AGENTS.md` links them as plain
files, so other agents can read and follow them.
| ID | Requirement | Acceptance criteria |
|---|---|---|
| PRO-1 | Start an intent. | `new-intent` finds the next number on `origin/main`, creates the folder from `intent/_template/` (intent, spec and plan, each `Status: draft`), adds the README row, and opens the docs PR (`intent/NNNN-name`, `Intent: NNNN`). |
| PRO-2 | Ship. | `ship` is the routine from Claude's memory, written for any agent. Steps: verify → commit → push → PR with `Intent:` → watch CI and fix failures → merge when green → wait for deploy → production test → TestFlight bump (its own PR) and upload → update the plan's Status → report. Each step says what to do if it fails and where to stop for the owner. |
| PRO-3 | Worktrees. | Both procedures work in a new worktree from `origin/main`, never by switching the shared checkout's branch. |

### 2.7 Security (WSEC)
| ID | Requirement | Acceptance criteria |
|---|---|---|
| WSEC-1 | Hooks don't leak. | No hook sends file contents anywhere. CCH-4 only reads check results. |
| WSEC-2 | The denylist stays secret. | `PERSONAL_DATA_DENYLIST` exists only as a GitHub secret. CIG-5 never prints it. It doesn't run on PRs from forks, which don't get the secret. |
| WSEC-3 | Standing permission is written down. | The ship routine's "merge and deploy without asking" is stated in `AGENTS.md` as the owner's decision, with its date and its limits (WF-1). |

## 3. Design

```
edit ──CCH-1 prettier, CCH-2 no migration edits──▶ commit ──GH-4 migrations, gitleaks──▶
push ──GH-2 pnpm verify, GH-3 not main, CCH-3 no --no-verify──▶ PR ──CI: verify, CIG-1..6, int, e2e──▶
merge ──CCH-4 checks green──▶ main ──CI──▶ Deploy
```

Enforcement, weakest to strongest: written rule (WF) → procedure (PRO) →
Claude hook (CCH, Claude only, every time) → git hook (GH, every agent,
can be skipped on purpose) → CI (everyone, can't be skipped, but a red PR
can still be merged by hand without branch protection).

New files: `AGENTS.md` (section), `.githooks/pre-push`,
`.githooks/pre-commit`, `.claude/hooks/{format,guard-bash,guard-edit,guard-merge}.sh`,
`scripts/check-intent.mjs`, `scripts/check-personal-data.mjs`,
`intent/_template/*`, `.claude/skills/{new-intent,ship}/SKILL.md`.

## 4. Testing
- `scripts/check-intent.mjs` gets unit tests: missing line, `none` with
  schema changes, a draft spec, docs-only PRs, several intents.
- Each hook script gets a shell test feeding it a sample tool-call JSON
  and checking whether it allows or blocks.
- This intent's own PRs are the end-to-end test: the docs PR passes
  CIG-2 while it is in draft (only `intent/**` changed), and the build PR
  passes only once this spec is approved.

## 5. Concerns for the owner
| # | Concern | Recommendation |
|---|---|---|
| W-1 | Without branch protection, a person or an agent that ignores its hooks can still merge a red PR or push to `main` with `--no-verify`. | Accept for now (default for question 1). Revisit if it ever happens. |
| W-2 | Every agent session, including other Claude sessions in the shared checkout, picks up the new hooks the next time it starts. A session in the middle of a push may be refused once. | Merge when no other session is pushing. |
| W-3 | `Intent: none` could become the easy way around the gate. | CIG-3 limits it, and the `ship` report lists any `none` PRs so the owner sees them. |
| W-4 | PRs opened before this merges have no `Intent:` line. | The gate applies only to PRs opened after it merges. Open ones get the line added by hand. |
