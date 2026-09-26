@AGENTS.md

# Project notes

- Requirements and decisions live in `intent/` (intent → spec → plan). Read
  `intent/0001-jayden-hub/spec.md` and `plan.md` before changing behaviour.
  When the build departs from the plan, update `plan.md` in the same commit.
- Commands: `pnpm lint`, `pnpm typecheck`, `pnpm test` (unit),
  `pnpm test:int` (needs `DATABASE_URL`), `pnpm build`, `pnpm test:e2e`.
- Schema changes: edit `db/schema/`, then `pnpm db:generate --name <what>`.
  Never edit generated SQL in `db/migrations/` by hand.
- Never commit secrets or real personal data about Jayden or other players
  (fixtures must be scrubbed).
