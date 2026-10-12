<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Workflow

How every change in this repo is made, by any agent or person (intent
0010). Each rule says what enforces it; "judgement" means nothing will
catch it for you.

## Where things live

- Requirements and decisions: `intent/NNNN-name/` (intent → spec → plan),
  rules in [intent/README.md](intent/README.md). Read
  `intent/0001-jayden-hub/spec.md` and `plan.md`, and the intent you're
  working on, before changing behaviour.
- Commands: `pnpm verify` (format, lint, typecheck, openapi, unit tests:
  what CI runs first), `pnpm verify:full` (adds integration tests; needs
  `DATABASE_URL`), `pnpm build`, `pnpm test:e2e`.

## The lifecycle

1. **Intent, spec, plan.** Write them with `Status: draft`, in one docs
   PR: follow [new-intent](.claude/skills/new-intent/SKILL.md). The owner
   approves them in chat or on the PR; set each `Status:` to
   `approved (owner, <date>, …)` and update the README table. _CI (PR
   gates / intent): code for an intent whose docs aren't approved fails._
2. **Build** only what the approved docs say. When the build departs from
   the spec or plan, update that file in the same commit. _Judgement; CI
   warns when code changes and the plan doesn't._
3. **New scope** after approval gets a new intent folder, not an edit to
   an approved one. _Judgement._
4. **What needs an intent:** any change to behaviour, the database schema
   or `infra/`. Fixes and chores (a message, an icon, a build number) can
   skip one: the PR says `Intent: none — <reason>`, and must not touch
   `db/schema/`, `db/migrations/` or `infra/`. _CI (PR gates / intent)._

## Rules for code

- **Run `pnpm verify` before pushing.** _Git pre-push hook; CI._
- **Never push to `main`.** Changes reach it by merging a PR. _Pre-push
  hook; Claude hook._
- **Never skip the hooks** (`--no-verify`, `-n`, changing
  `core.hooksPath`). Fix what they report. _Claude hook; CI catches the
  rest._
- **Schema changes:** edit `db/schema/`, then run
  `pnpm db:generate --name <what>`. Never edit generated SQL in
  `db/migrations/` by hand. _Claude hook; commit-msg hook._
- **No secrets or real personal data** about Jayden, his brother or other
  players, coaches and schools. Fixtures are scrubbed. _gitleaks in CI
  (PR gates / secrets) and in the pre-commit hook when installed; CI
  also fails on names from the owner's private denylist._
- **Work in a worktree from `origin/main`** (`git worktree add`), not by
  switching the branch of a shared checkout: other sessions use it.
  _Judgement._

## Shipping

The owner's standing decision (2026-10-03, intent 0010 question 3): once
the docs are approved, any agent ships without asking at each step. The
full procedure is [ship](.claude/skills/ship/SKILL.md); in short:

1. Build in a worktree; `pnpm verify` (and `verify:full` if the change
   touches the database) passes.
2. Commit, push, open the PR against `main`. The description has an
   `Intent:` line (`Intent: 0010`, or `Intent: none — <reason>`).
3. Watch CI (in the Claude desktop app, turn on Auto-fix for the PR);
   fix every failure on the branch.
4. When every check has passed, merge it (`gh pr merge <n> --merge`).
   _Claude hook: refuses while any check isn't green._
5. Wait for Deploy (it runs after CI passes on `main`), then test the
   change on production.
6. If the iPhone app changed: bump `CURRENT_PROJECT_VERSION` in
   `ios/project.yml` in its own small PR, then archive and upload to
   TestFlight ([ios/README.md](ios/README.md), "Release").
7. Update the intent's plan Status, and report to the owner: what
   shipped, PR links, what's left for them.

**Always ask the owner first:** Terraform apply, deleting anything
(data, branches others use, cloud resources), anything outside this flow.
Production tests that need the owner's account or real data (a real email,
their phone) are reported as waiting on them, never faked.
