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

## Built (2026-09-27, local session)
All of M3.2–M3.7 is built on this branch; details in plan.md "Build
notes (M3)". Checks run locally: format, lint, typecheck, unit (139),
integration (35), `pnpm build`, `pnpm check:build`, e2e (93 passed, 13
desktop-only tests skipped on the phone project).
- **M3.2 schema:** split out onto `m3/2-schema` (from `main`) with the
  migrations test extended for the match rules, and merged back into this
  branch. Its PR to `main` goes first: it's schema only, so deploying it
  just runs migration 0007. After it merges, schema changes are new
  migrations (this branch already adds 0008).
- **M3.3:** `src/server/tennis/apply.ts` writes a sync; the worker applies
  it after the events; `smoke` prints tennis counts. Sources takes his
  profile link for `tennis_tc`. The "Tennis Canada tournaments" login stays
  on the Accounts page until O-5 is settled.
- **M3.4:** `/tennis` pages and `/api/v1/tennis/*`; e2e in
  `tests/e2e/tennis.spec.ts`.
- **M3.5:** `src/domain/glicko2.ts` (matches the paper's example),
  `src/domain/tennis-predict.ts`, `/tennis/accuracy`,
  `scripts/tennis-backtest.ts`.
- **M3.6:** `src/server/tennis/explain.ts`, table `tennis_explanations`
  (0008), Terraform env `VERTEX_PROJECT` / `CLAUDE_VERTEX_REGION` on the
  worker job (IAM `roles/aiplatform.user` was already there).
- **M3.7:** `src/server/tennis/mutations.ts`, edit and add forms; e2e shows
  an edit surviving the next sync.

## Before merging (owner)
1. Merge the `m3/2-schema` PR first.
2. Apply Terraform from this branch (worker env for Vertex), before the
   code that reads it is deployed.
3. Ask for Claude quota on Vertex AI: a test call on 2026-09-27 got
   "429 Quota exceeded for ... global_online_prediction_requests_per_base_model
   ... anthropic-claude-opus" on the `global` endpoint (`us-east5` doesn't
   serve `claude-opus-5` to the project). Until then the sync logs
   "tennis explanation failed" and the pages show the numbers without the
   paragraph. Then re-record the fixture:
   `RECORD_LLM=1 VERTEX_PROJECT=<project> pnpm exec vitest run --project integration tests/integration/tennis-explain.test.ts`
   (needs `gcloud auth application-default login`), and check the new
   snapshot.
4. After deploy: add the Tennis Canada source on the Sources page with his
   profile link, press Refresh (the M3.3 live smoke test), and check his
   tournaments on the calendar. Then run `scripts/tennis-backtest.ts`
   against production (through the Cloud SQL proxy) for the PR's
   calibration table; it prints aggregates only.

## Still to do
- **O-5 signed-in look** (owner in the desktop app's browser pane; see
  below). If signed-in pages show entries before draws, add the `/user`
  sign-in to the adapter and an "entered" state before the draw.
- The fixture backtest (112 matches, almost all "low" confidence) is
  barely better than a coin toss (Brier 0.245 against 0.25). Real data
  will have more history; revisit the weights once the production numbers
  are in.

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
- The profile link is pasted on the Sources page after deploy (step 4
  above).
- Still open from M1: M1.6 live smoke and M1.7 (O-6 feed links), and the
  M1.13 restore test.
