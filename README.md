# jaydenguo.com

A private hub for Jayden's schedule, sports results and school work. See
[`intent/`](intent/) for the intent, spec and build plan.

## Run it locally

Requirements: Node.js 22+, pnpm (`corepack enable`), Docker. (No Docker?
Any local PostgreSQL 16 works: point `DATABASE_URL` at it instead of running
`pnpm db:up`.) A fresh clone reaches a running app with sample data in a
few minutes, most of it `pnpm install`.

```bash
pnpm install
pnpm db:up                                  # Postgres 16 in Docker
cp .env.example .env.local
export DATABASE_URL=postgres://hub:hub@localhost:5432/hub
pnpm db:migrate
pnpm seed                                   # a made-up season: clashes, swim meets and results
pnpm dev                                    # http://localhost:3000
```

Sign in at <http://localhost:3000/auth/dev> (a shortcut that exists only in
`pnpm dev`), or with Google after adding the local OAuth client to
`.env.local` (see `infra/README.md`, "Google sign-in").

## Checks

| Command                                              | What it runs                                                          |
| ---------------------------------------------------- | --------------------------------------------------------------------- |
| `pnpm lint` / `pnpm typecheck` / `pnpm format:check` | Static checks                                                         |
| `pnpm test`                                          | Unit tests                                                            |
| `pnpm test:int`                                      | Integration tests against `DATABASE_URL`                              |
| `pnpm build`                                         | Next.js standalone build and the worker bundle (`dist/worker.mjs`)    |
| `pnpm test:e2e`                                      | Browser tests against the production build (run `pnpm build` first)   |
| `pnpm check:build`                                   | Confirms the dev sign-in shortcut is absent from the production build |

## Worker jobs

Background work runs as jobs of one worker program, locally and on Cloud Run:

```bash
pnpm job help        # list jobs
pnpm job migrate     # apply database migrations
pnpm job sync all    # sync every enabled source now
pnpm smoke <id>      # live check of one source, saves nothing
pnpm seed            # sample data for local development
```
