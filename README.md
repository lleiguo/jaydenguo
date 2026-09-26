# jaydenguo.com

A private hub for Jayden's schedule, sports results and school work. See
[`intent/`](intent/) for the intent, spec and build plan.

## Run it locally

Requirements: Node.js 22+, pnpm (`corepack enable`), Docker.

```bash
pnpm install
pnpm db:up                                  # Postgres 16 in Docker
cp .env.example .env.local
export DATABASE_URL=postgres://hub:hub@localhost:5432/hub
pnpm db:migrate
pnpm dev                                    # http://localhost:3000
```

## Checks

| Command                                              | What it runs                                                        |
| ---------------------------------------------------- | ------------------------------------------------------------------- |
| `pnpm lint` / `pnpm typecheck` / `pnpm format:check` | Static checks                                                       |
| `pnpm test`                                          | Unit tests                                                          |
| `pnpm test:int`                                      | Integration tests against `DATABASE_URL`                            |
| `pnpm build`                                         | Next.js standalone build and the worker bundle (`dist/worker.mjs`)  |
| `pnpm test:e2e`                                      | Browser tests against the production build (run `pnpm build` first) |

## Worker jobs

Background work runs as jobs of one worker program, locally and on Cloud Run:

```bash
pnpm job help        # list jobs
pnpm job migrate     # apply database migrations
```
