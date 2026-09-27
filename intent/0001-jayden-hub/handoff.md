# Handoff: M3 Tennis (2026-09-27)

Where M3 stopped, for whoever picks it up next. Read with [plan.md](plan.md)
§5 (M3 table and "Build notes (M3)") and [spikes.md](spikes.md) SP-2.

Branch: `claude/m3-tennis-feature-94v4q6`, from `main` at `cf0af47` (M2
merged). Everything below is committed there, including work in progress.
**Don't merge it as is**: M3.2 and M3.3 are unfinished (see below). Merging
deploys, and the migration would run.

## Starting state checked
- `origin/main` has "m2/3-pages" (#16), so M2's code is in.
- The owner's M2 live check passed (2026-09-27).
- Still open from M1: M1.6 live smoke and the M1.7 Spordle decision (O-6
  feed links), and the M1.13 restore test (`infra/bootstrap/restore-test.sh`).

## Done
- **M3.1 (SP-2), done.** Page map, findings and decision in spikes.md SP-2.
  - `src/adapters/tennis-tc/parse.ts`: pure parsers for every page used
    (profile, years, tournaments per year, tournament overview, bracket,
    draw match list, error pages). They read whitelisted fields only.
  - `tests/fixtures/tennis-tc/`: 17 scrubbed pages plus `manifest.json`
    (fake IDs). The leak check passed. They're listed in `.prettierignore`
    so the HTML stays as recorded.
  - `tests/e2e/support/fake-tc.ts` (+ `fake-tc-port.ts`, port 4467): serves
    the fixtures at the real paths, redirects `/player/<org>/<member>`
    like the site does, returns the site's 200 error page for anything
    else, and plants contact details on the profile page to prove the
    adapter drops them. `TC_NOW` (2024-09-28T16:00Z) is the day between
    his quarter final and his semi final in the fixture.
  - `scripts/tennis-tc-probe.ts`: the SP-2 "done when" script. It ran live
    and printed his last 10 matches and one opponent's (output kept
    outside the repo).

## In progress (committed, unfinished)
- **M3.2 schema:** split out onto `m3/2-schema` (from `main`, 2026-09-27)
  with the migrations test extended for the match rules; that branch is
  merged back into this one. Open its PR against `main` and merge it
  first: it's schema only, so deploying it just runs migration 0007. If
  the schema changes before that merge, delete 0007 (and its entry in
  `db/migrations/meta`) and generate it again on `m3/2-schema` rather than
  adding a 0008. After it merges, any change is a new migration.
- **M3.3 adapter, partly built:**
  - Done and checked by hand against the fake site:
    `src/adapters/tennis-tc/index.ts` (HTTP client with cookie jar,
    loopback-only `TENNIS_TC_BASE_URL`, request cap, crawl order,
    opponent queue) and `normalise.ts` (players, tournaments, draws with
    next match, matches, calendar records). Against the fixtures: 46
    requests; the next match comes out as "Semi final vs <opponent>" with
    seed 1, line 1 of 16; the compass draw comes out as "out"; no warnings;
    none of the planted contact details are kept.
  - `src/domain/tennis-draw.ts` (position, seed, next opponent or "winner
    of A vs B") and `src/domain/tennis-upsert.ts` (batch types,
    `planTournaments`, `planMatches` with the TEN-8 rules and linking of
    hand-entered matches). Neither has tests yet.
  - Wired in so far: `tennis?: TennisBatch` on `NormalisedBatch`
    (`src/adapters/types.ts`) and `tennis_tc` in `src/adapters/registry.ts`.
  - **Not wired:** nothing writes the tennis batch to the database, and
    the Sources API doesn't accept `tennis_tc` yet, so no tennis source can
    be created. The calendar part would already work through the generic
    event upsert.
- Dependency added: `node-html-parser` (`pnpm audit --prod` clean).

## Next, in plan order
1. **M3.3, finish:**
   - `src/server/tennis/apply.ts`, like `src/server/swim/apply.ts`: one
     transaction with an advisory lock. Upsert players by member number;
     plan and write tournaments; replace the draws of tournaments this run
     read; plan matches (`planMatches`, with `selfKey` = his member number
     and `sameOpponent` matching a hand-typed opponent by name); write
     revisions and a `change_log` row of kind `tennis`. Map player keys
     (member number or `player:<uuid>`) to `tennis_players.id`. Set
     `profile_fetched_at` for players with `profileFetched`.
   - Call it from `src/worker/sync.ts` after the events, like `batch.swim`,
     and add tennis counts to `smokeJob`.
   - Sources: add `tennis_tc` to `SOURCE_KINDS`, `createSourceInput` and
     `updateSourceInput` in `src/server/sources.ts`. The credential becomes
     optional for this kind; `config.profileUrl` is required and validated
     with `profileIdFromLink`. In `src/components/sources/sources-panel.tsx`,
     add a profile-link field instead of the account picker, with default
     category tennis. Decide whether to keep the "Tennis Canada
     tournaments" login on the Accounts page (see owner decisions).
   - Tests: unit tests for the parsers on the fixtures, `tennis-draw`
     (knockout, feeder, bye, compass, won, out) and `tennis-upsert`
     (idempotent, never cancels on an empty fetch, never cancels
     opponents' matches, keeps corrections, links hand-entered matches);
     `tests/unit/adapter-tennis-tc.test.ts` running `fetchTennis` +
     `normaliseTennis` against `createFakeTc` on port 0 (no browser
     needed); `tests/integration/tennis-sync.test.ts` like
     `swim-sync.test.ts` (sync twice = no changes; a second sync after
     backdating `sync_runs`; nothing from `PLANTED_PRIVATE` stored).
     Add the fake to `playwright.config.ts` webServers and
     `TENNIS_TC_BASE_URL` to the app's env there; wipe tennis tables in
     `tests/e2e/support/global-setup.ts`.
   - Seed data (`src/worker/seed.ts`): a sample tennis source and a few
     matches, if the pages need them.
2. **M3.4 pages:** `src/server/tennis/load.ts` read models, served under
   `/api/v1/tennis/*` and read by server components under
   `src/app/(app)/tennis/`: tournaments (upcoming, in progress, past), a
   tournament with his draws and next match, a head-to-head per opponent
   (from stored matches, singles only), opponent form (last 10, 12-month
   win rate), and results with a season filter and a running W–L. A
   "Refresh" button like swimming's. e2e in `tests/e2e/tennis.spec.ts`
   (desktop only, serial, shared source).
3. **M3.5 Glicko-2:** `src/domain/glicko2.ts` (unit tests against the
   worked example in Glickman's Glicko-2 paper), `tennis-predict.ts` (win
   probability with small head-to-head, form and margin adjustments;
   confidence low when either player has fewer than 5 rated matches), a
   "How accurate is this?" page, and `scripts/tennis-backtest.ts` printing
   aggregate calibration only. The chart pattern is
   `src/components/swim/progression-chart.tsx` (hand-drawn SVG, CSS
   classes, dataviz palette) with a CSP-violation check in e2e.
4. **M3.7 edits:** add or correct a score or time (`src/server/tennis/mutations.ts`
   like `swim/mutations.ts`, "Use the site's result", "source disagrees"
   flag). e2e: an edit survives the next sync.
5. **M3.6 explanation from Claude on Vertex:** unblocked (O-8 answered
   below). Load the claude-api skill before writing it.

## Where the build departed from the plan
All recorded in plan.md "Build notes (M3)":
- Plain HTTP plus an HTML parser instead of Playwright; public pages only;
  the source uses his profile link instead of a stored login.
- Ratings are computed, not stored.
- `tennis_draws` stores only his draw position and next match, not the
  whole draw (privacy).
- One branch (`claude/m3-tennis-feature-94v4q6`) instead of stacked
  `m3/…` branches: this cloud session can only push to that branch.

## Gotchas
- **Privacy:** never print raw pages or names to a transcript. Inspect
  shapes (classes, counts) only. Real pages and probe output belong in the
  session scratchpad. To refresh fixtures, re-run the scrubber (a Python
  script kept outside the repo, described in spikes.md SP-2) and the leak
  check, then grep the branch diff for the real strings before pushing.
- The site returns **status 200 for error pages**. `isErrorPage` checks
  the content.
- **Unplayed matches carry no member numbers.** Players are resolved
  through tournament player numbers learned from played matches.
- **Seeds** appear as "Name [1]" in draws; the parser splits them off.
  Without that, names don't match across pages.
- Draw **match lists are in schedule order**; use the bracket fragment
  (`GetDrawContent`) for draw order.
- In cloud sessions, Node's `fetch` ignores `HTTPS_PROXY`: run live
  scripts with `NODE_USE_ENV_PROXY=1` (and allow `tc.tournamentsoftware.com`
  in the environment's network settings). Not needed on Cloud Run.
- `tsx` scripts can't use top-level await here (CJS transform); wrap them
  in `main()`.
- Keep the home time zone out of the repo: fixtures use Toronto offsets.
- Not run on this branch yet: `pnpm build`, `pnpm check:build`,
  `pnpm test:e2e`. These passed: format, lint, typecheck, unit (94),
  integration (29).

## Owner decisions (answered 2026-09-27)
- **M2 live check:** passed. M2 is done (plan §9).
- **O-8, Claude on Vertex for M3.6:** enabled. The owner accepts sending
  the computed match numbers (never raw pages or profiles) to a region
  outside Canada if Claude isn't served in one. At M3.6, pick the region
  and model from what the project offers, and add the worker's Vertex IAM
  in Terraform (apply it from the branch before merging).
- **O-5, signed-in look:** wanted. Still to do: the owner signs in to
  tc.tournamentsoftware.com themselves, in the Claude desktop app's
  browser pane (as for SP-3), and Claude reads pages only. The questions:
  do upcoming entries show before the draw is published, and does
  anything else differ from the public pages? A cloud session can't do
  this: it has no browser pane, and the password must never go in chat. If
  entries do show, add an optional sign-in to the adapter (the `/user`
  form POST) using the login entered on the Accounts page, whose "Tennis
  Canada tournaments" option then stays.
- **Crawl size:** up to 30 opponents and 150 requests per run is OK.
- **robots.txt:** noted by the owner; covered by F-1.

## Still open
- The profile link is pasted on the Sources page once M3.3 lands.
- Still open from M1: M1.6 live smoke and M1.7 (O-6 feed links), and the
  M1.13 restore test.
  covered by the accepted F-1 risk, but worth knowing.
