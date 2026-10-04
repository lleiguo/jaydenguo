---
name: ship
description: Build and ship an approved intent milestone (or a small fix) in this repo — verify, PR with the Intent line, fix CI, merge when green, wait for deploy, test production, TestFlight if the app changed, report. Use after the owner approves an intent's docs, or for a fix that needs no intent.
---

# Ship (intent 0010, PRO-2)

The owner's standing decision (2026-10-03): once the docs are approved,
any agent runs these steps without asking at each one. Any agent can
follow this file; it's linked from `AGENTS.md`.

**Stop and ask the owner for:** Terraform apply; deleting anything (data,
cloud resources, branches others use); anything not in these steps.

## 1. Build

- Worktree from `origin/main`, then `pnpm install`, which turns the git
  hooks on:
  `git worktree add -b <area>/<name> <dir> origin/main`.
- Build what the approved spec and plan say, with tests. If the build
  departs from them, edit `spec.md` or `plan.md` in the same commit.
- `pnpm verify` passes. If the change touches the database or a worker
  job, `pnpm verify:full` passes too (it needs `DATABASE_URL`).
- Schema: edit `db/schema/`, then `pnpm db:generate --name <what>`.
- API types changed: `pnpm openapi` and commit `openapi.json`.

## 2. PR

- Commit, then push. The pre-push hook runs `pnpm verify`; fix what it
  reports, never skip it.
- `gh pr create --base main`. The description starts with
  `Intent: NNNN` (or `Intent: none — <reason>` for a fix: not for
  schema, migrations or infra), then what changed and how it was tested.

## 3. CI

- Wait for the CI, PR gates and iOS checks (`gh pr checks <n> --watch`).
- Fix each failure on the branch and push again. A flaky e2e test gets
  one re-run (`gh run rerun <id> --failed`); a second failure is real.
- `PR gates / intent` failing: fix the `Intent:` line, or get the docs
  approved first.

## 4. Merge

- Only when every check has passed: `gh pr merge <n> --merge`. (Claude's
  hook refuses before then; other agents check `gh pr checks <n>`
  themselves.)

## 5. Deploy and production test

- Deploy starts when CI passes on `main`; find it with
  `gh run list --workflow Deploy -L 1`. Wait for it to finish. If it
  fails, read its log and fix forward with a new PR, never by hand in the
  cloud console.
- Test the change on production the way a parent would use it. A test
  that needs the owner's account, phone or real data is listed as
  waiting on them, never faked.

## 6. iPhone app (only if `ios/` changed)

- In its own PR (`Intent: none — TestFlight build N`): bump
  `CURRENT_PROJECT_VERSION` in `ios/project.yml`.
- After it merges: archive and upload ([ios/README.md](../../../ios/README.md),
  "Release").

## 7. Report

- Update the intent's `plan.md` Status and the `intent/README.md` row
  (a docs PR, `Intent: NNNN`).
- Tell the owner: what shipped, with PR links; what was tested on
  production; what's waiting on them.
