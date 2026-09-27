# Handoff: M4 School (2026-09-27)

For whoever starts M4. Read with [plan.md](plan.md) §5 (the M4 table),
[spec.md](spec.md) §3.8 (SCH), CAL-3a, CAL-7, SRC-7, SRC-8, F-5 and F-7,
and [spikes.md](spikes.md) SP-4.

## Starting state
- `main` at `cfc480f` has M0–M3 merged (M3: PRs #17, #18). Deployed
  through GitHub Actions on merge.
- M4 is not started. No `veracross` or `classroom` adapter exists yet.

## What M4 can build on (already in `main`)
- **Categories and layers:** `school_class` and `school_closure` exist
  (`src/domain/constants.ts`, `src/components/calendar/categories.ts`).
  The School/Activities chips (CAL-3a) and closure banners (CAL-7) are in
  `src/components/calendar/calendar-app.tsx`; closure banners stay visible
  when School is hidden.
- **Clash rules for school:** `src/domain/clashes.ts` already skips classes
  on closure days, never clashes class with class, and marks activities
  on closure days "school closed" (`src/server/calendar/load.ts`).
- **School calendar feed:** the generic `ical` adapter
  (`src/adapters/ical`) can read a Veracross calendar subscription link
  (a `secret_url` credential; the Accounts page already offers
  "Veracross" with kinds `secret_url` and `password`). Map its closures to
  `school_closure` with category rules on the Sources page.
- **Google grants:** `src/server/credentials/google-connect.ts` asks for
  scopes per feature (`GOOGLE_SCOPES`, only `calendar` so far). Classroom
  scopes would be added there as a new feature.
- **Patterns to copy:**
  - Adapter over plain HTTP with a cookie jar, request cap, loopback-only
    test base URL: `src/adapters/tennis-tc/index.ts`.
  - Adapter through Chromium when a site needs a browser:
    `src/adapters/commit-swim`.
  - Fake site for tests serving scrubbed fixtures:
    `tests/e2e/support/fake-tc.ts` (+ `fake-tc-port.ts`), wired into
    `playwright.config.ts` and wiped in `tests/e2e/support/global-setup.ts`.
  - Sport-specific tables applied after events in `src/worker/sync.ts`
    (`batch.swim`, `batch.tennis`), pure upsert rules in
    `src/domain/*-upsert.ts`, read models in `src/server/*/load.ts`.
  - Test-only clock: `TENNIS_TC_NOW`, honoured only with a loopback
    `TENNIS_TC_BASE_URL` (`tennisTestNow()` in the tennis adapter).

## Plan order
1. **M4.1 = SP-5, Classroom access spike (F-5).** Needs the owner (O-7):
   they sign in with Jayden's school Google account and consent. Try the
   Classroom API read of courses and coursework
   (`classroom.courses.readonly`, `classroom.coursework.me.readonly`, and
   the student-submissions scope for grades). If the school's Workspace
   admin blocks third-party apps, record the exact error in spikes.md and
   choose a fallback with the owner: (1) Classroom guardian email
   summaries parsed from Gmail (needs M5's Gmail adapter, EML), or
   (2) manual entry. Its done-when is "works, or a fallback is chosen".
   Note: a student account is a different Google account from the owner's;
   the connect flow must let the owner pick it (the grant is still stored
   as the owner's credential, CRED).
2. **M4.2 Veracross.** First finish SP-4 for Veracross (F-7): does the
   parent portal give a calendar subscription link (then it's just an
   `ical` source), and how is the daily timetable shown (scrape)? The
   timetable scraper is a new `veracross` adapter using the stored parent
   login (O-7). Done when: fixture tests, a "Today at school" card
   (periods, classes, rooms, teachers), closures as banners, and **school
   blocks collapse into one "School" block by default and expand** (SCH-1;
   not built yet, nothing in the calendar collapses today).
3. **M4.3 Classroom adapter** (or the fallback): homework with states
   (assigned, turned in, late, missing), "missing" and "due in 24 h"
   highlighted, upcoming due dates in the agenda, grades per course with a
   trend. Needs new tables (e.g. courses, assignments, submissions or
   grades): edit `db/schema/`, then `pnpm db:generate --name school`.
   The next migration is 0009.
4. **M4.4 links and layer:** every school item links back to Classroom or
   Veracross (SCH-5); homework due dates and school events sit in the
   School layer (CAL-3a). e2e test.

Branches: one PR per milestone or smaller, each targeting `main` (stacked
`m4/…` branches worked well in M2; give the owner PR links that target
`main`). Update plan.md §9 and the M4 build notes in the same PRs.

## Privacy (school data)
- Veracross and Classroom pages show other children, teachers and
  families. Read whitelisted fields only, like the tennis and swim
  parsers. Never print raw pages, rosters or names into a transcript;
  inspect shapes (classes, counts) and keep real pages in the session
  scratchpad.
- Fixtures must be scrubbed before they enter the repo (the repo is
  public): fake names, rooms, teachers, course names and IDs; keep the
  school's name and the home time zone out. Grep the branch diff for real
  strings before pushing. See spikes.md SP-2/SP-3 for how the scrubber and
  leak check were done.
- Grades and homework are Jayden's own data: they stay in Cloud SQL
  (Canada) and are never sent to an LLM in M4.

## Owner steps M4 needs
- **O-7:** the Veracross parent login (entered on the Accounts page, never
  in chat) and, if offered, the Veracross calendar subscription link.
- **O-7 / F-5:** consent with Jayden's school Google account during SP-5,
  done by the owner in the Claude desktop app's browser pane or their own
  browser. Claude never handles the password.
- Possibly: a new OAuth scope on the Google consent screen for Classroom
  (the app is an unverified personal app, F-6; Classroom scopes are
  sensitive, so Google shows the unverified warning).

## Still open from earlier milestones
- **M3.6:** the explanation fixture `tests/fixtures/llm/tennis-explain.json`
  is still the hand-written stand-in (`recorded: false`). The project had
  no Claude quota on Vertex (all three global `anthropic-claude-opus`
  quotas were 0 on 2026-09-27; the owner was shown how to request 5
  requests, 20,000 input and 10,000 output tokens per minute). Once
  granted, re-record:
  `RECORD_LLM=1 VERTEX_PROJECT=jaydenguo DATABASE_URL=… pnpm exec vitest run --project integration tests/integration/tennis-explain.test.ts -u`
  and review the new snapshot.
- **M3.3 live smoke:** after deploy, the owner adds the Tennis Canada source
  with his profile link and presses Refresh. Then run
  `scripts/tennis-backtest.ts` against production for the calibration
  table (aggregates only).
- **O-5 signed-in look** at tc.tournamentsoftware.com (do upcoming entries
  show before draws?), done by the owner in the browser pane.
- **M1:** M1.6 live smoke and M1.7 Spordle decision (O-6 feed links), and
  the M1.13 restore test (`infra/bootstrap/restore-test.sh`).

## Local environment (owner's Mac)
- Postgres 16 on port 5433 (Homebrew; PG14 holds 5432):
  `DATABASE_URL=postgres://hub:hub@localhost:5433/hub`. The integration and
  e2e suites share this database with local dev.
- pnpm 10.33 lives in `~/.local/bin` (add it to `PATH`). Run
  `pnpm install` after switching branches.
- `gh` isn't signed in; `git push` over SSH works. Give the owner compare
  links (`https://github.com/lleiguo/jaydenguo/compare/main...<branch>?expand=1`).
- `.claude/worktrees/` makes `pnpm lint` and `pnpm format:check` report
  bogus problems; run `eslint --ignore-pattern '.claude/**'` and check
  prettier on the changed paths.
- gcloud application-default credentials work for project `jaydenguo`.
  Terraform is initialised in `infra/` with `prod.tfvars` (untracked); apply
  with `terraform apply -var-file=prod.tfvars` before merging code that
  needs new env or secrets.
- In Playwright, `getByLabel("Name")` matches any label containing "name"
  (e.g. "tournament"); word new labels and options with that in mind, or
  use `{ exact: true }`.
- `tsx` scripts: wrap top-level code in `main()`.

## Checks before every push
`pnpm typecheck`, lint, `pnpm test`, `pnpm test:int` (needs
`DATABASE_URL`), `pnpm build`, `pnpm check:build`, and `pnpm test:e2e`
for the areas touched. Last full run on `main`'s code (2026-09-27): unit
139, integration 35, e2e 93 passed (13 desktop-only skipped on phone).
