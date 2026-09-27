# Spike notes: 0001 Jayden hub

Findings from the time-boxed spikes in [plan.md §4](plan.md). Each note
says what was checked, what was found, and what changed as a result.

## SP-1: Google Cloud services in Toronto (2026-09-26, partial)

**Checked from the build environment:** nothing directly. Google's
documentation sites (`docs.cloud.google.com`, `firebase.google.com`) are
blocked by the build environment's network policy, and there is no GCP
project yet.

**Expected (from prior knowledge, to be confirmed):**
| Service | Toronto (`northamerica-northeast2`) |
|---|---|
| Cloud Run services and jobs | Expected yes |
| Cloud SQL for PostgreSQL | Expected yes |
| Cloud KMS, Secret Manager (user-managed replica), Artifact Registry, Cloud Storage | Expected yes |
| Cloud Scheduler | Unsure; it only schedules, holds no personal data |
| Regional Cloud Logging buckets | Expected yes |
| Firebase Hosting rewrites to Cloud Run in this region | **Unsure**, see F-14 |

**How it gets confirmed:** the owner runs `infra/bootstrap/check-regions.sh`
in step 4 of `infra/README.md`. The first `terraform apply` is the final
check: it fails on any resource the region doesn't offer.

**Result (2026-09-26):** the owner's first `terraform apply` in
`northamerica-northeast2` succeeded. So Toronto offers every resource in
`infra/`: Cloud Run service and job, Cloud SQL PG16 with in-region backups,
KMS, Secret Manager replica, Artifact Registry, Storage, regional log bucket,
and Firebase Hosting rewrites to Cloud Run (the F-14 region question). The
region script failed on macOS for an unrelated reason (no `timeout`
command) and has been fixed; its output only adds Cloud Scheduler, which
is created in M1.5.

## SP-4: calendar feeds for TeamSnap, Spordle and Veracross (M1.7, 2026-09-27, provisional)

**Owner mapping (O-6):** soccer uses TeamSnap, hockey uses Spordle. The
owner hasn't looked for the subscription links yet.

**Found so far:**
| Source | Feed? | Decision |
|---|---|---|
| TeamSnap | Yes: every team schedule has a calendar subscription (iCal) link. | ICS, generic `ical` adapter. |
| Spordle | Likely: the Spordle app has calendar synchronisation on teams with a Premium subscription (app 1.5.1+), and the Spordle account site has a calendar. Whether a plain iCal link is exposed isn't confirmed. | ICS if a link exists; otherwise a `spordle` login adapter (Playwright), decided when the owner checks. |
| Veracross | Parent portals usually offer a calendar subscription link for the school calendar. The daily timetable needs scraping either way. | Checked in M4 (SP-5/M4.2); the `ical` adapter already handles the calendar feed. |

**How the owner checks:** TeamSnap → the team → Schedule → Sync/Export
calendar → copy the link. Spordle → the team → Schedule → the calendar sync
icon (or My Account → Calendar) → copy the subscription link. Paste each
link only into the site's Accounts page (TeamSnap/Spordle → "Add private
calendar link"), never into chat or the repo.

**Adapter:** `src/adapters/ical/` expands recurring events (RRULE, EXDATE,
moved occurrences) in the feed's own time zone, drops `STATUS:CANCELLED`
events so sync marks them cancelled, and keeps all-day events as dates.
Fixture tests in `tests/unit/adapter-ical.test.ts`.

## SP-2: Tennis Canada tournament site (M3.1, 2026-09-27)

**Checked:** `tc.tournamentsoftware.com` from the build environment, signed
out, reading pages only. The owner allowed the host in the cloud
environment's network settings. Only page structure (tags, classes, counts)
was inspected; no page contents went into the transcript or the repo.

**How the site works:** an ASP.NET site whose pages are server-rendered
HTML. Some parts load as HTML fragments (sent with
`X-Requested-With: XMLHttpRequest`). No JavaScript is needed to read them,
so the adapter uses plain HTTP and an HTML parser (`node-html-parser`)
instead of Chromium. Everything TEN-2..7 needs is **public**: no sign-in
was needed for any page below. Error pages (e.g. 404) come back with status
200, so the adapter recognises them by content.

**Page map:**
| Page | Path | Gives |
|---|---|---|
| Player profile | `/player-profile/<guid>` | Name, club/region group, member number (`data-uldata3` on the favourite button) |
| Profile, Tournaments tab | `/player-profile/<guid>/tournaments` | The years with tournaments (`data-href` per year) |
| One year of tournaments (fragment) | `/player-profile/<guid>/tournaments/<year>/TournamentsForYear` | Each tournament (ID, name, venue, start date, category tags), each event (`h4.module-divider`) and draw (`h5`, link with `draw=<n>`), and every match he played: both sides, winner (`has-won`), games per set (`ul.points`), round (when shown), date and sometimes time |
| Tournament overview | `/tournament/<guid>` | Name, entry opens, closing deadline, withdrawal deadline, start and end dates, venue (name, locality, region), category tags |
| Draw bracket (fragment) | `/tournament/<guid>/Draw/<n>/GetDrawContent` | Knockout rounds (`.bracket-round__item`) in draw order, with round names, players, seeds ("[1]" after the name), scores and scheduled times |
| Draw match list (fragment) | `/tournament/<guid>/Draw/<n>/GetMatchesContent` | Same matches in schedule order (not bracket order); used for round robin draws |
| Player in a tournament | `/tournament/<guid>/player/<n>` | Links to that player's profile |
| Profile by member number | `/player/<org guid>/<base64("base64:<member>")>` | Redirects to the profile |

**Findings:**
- **Identity:** the member number is the one ID that holds across
  tournaments. Match rows carry it only in the head-to-head link
  (`T1P1MemberID`, `T2P1MemberID`, `…P2…` for doubles), so **unplayed
  matches have no member numbers**, only a per-tournament player number.
  The adapter maps tournament player numbers to members from played
  matches, and reads a next opponent's profile through the tournament
  player page.
- **Next opponent:** a draw's match list is in schedule order, but the
  bracket fragment lists rounds in draw order. In a knockout draw (rounds
  of 8, 4, 2, 1 matches), match k is fed by matches 2k and 2k+1 of the
  round before, which gives "winner of A vs B" when the slot is empty. The
  site fills winners into the next round itself. Rookie (U9/U10) events
  often use **compass draws** (7 bracket rounds of mixed sizes); those only
  get "first unplayed match".
- **Scores:** games per set, one `ul.points` per set; no tiebreak points in
  the markup. Walkovers show as a `match__message` tag. Byes are one-sided
  matches with a winner and no score.
- **Dates and times** are printed as "Sun 2026-09-20 12:00 PM" with no time
  zone. Deadlines on the overview carry the organisation's offset.
  Scheduled times are read in the home time zone setting.
- **Only a start date** is on the year pages; multi-day end dates come from
  the overview page, so the adapter reads overviews only for recent and
  upcoming tournaments.
- **No rankings** were shown for his age group; TEN-5's "ranking if shown"
  stays empty until a profile shows one.
- **robots.txt** disallows `/player-profile/`, `/player/`, `/head-2-head`
  and `/ranking/` for crawlers. This is the F-1 risk the owner accepted:
  pages the owner can see, once a day plus on demand, one request every
  2 s, a cap per run.
- **Sign-in** is a plain form POST (`/user`, `Login`, `Password`,
  anti-forgery token). Not used, because the public pages are enough.
  Still to check: whether signed-in pages show **upcoming entries before
  the draw is published** (open owner decision, see handoff.md).
- **Privacy:** tournament pages carry organisers' phone numbers and
  addresses, and profiles link to photos. The parsers read whitelisted
  fields only (names, member numbers, club, results, dates, venue).
- In this build environment Node's `fetch` ignores `HTTPS_PROXY`; the live
  probe needs `NODE_USE_ENV_PROXY=1`. Cloud Run has no proxy, so production
  is unaffected.

**Probe:** `scripts/tennis-tc-probe.ts <profile link>` runs the real crawl
and prints his last 10 matches and one opponent's last 10. Run on
2026-09-27 with a 60-request cap, it printed both lists (20 matches;
output kept outside the repo).

**Fixtures:** `tests/fixtures/tennis-tc/*.html` are real pages (his
profile, two years of tournaments, two tournament overviews, a compass and
a knockout draw, a tournament player page, three opponents) with scripts,
navigation, footers, images and contact links removed. Every name, club,
venue, city, tournament and event name is replaced with a fake, GUIDs and
member numbers are remapped, dates are moved 104 weeks earlier (weekdays
kept), offsets are set to Toronto's, and losing games are nudged by ±1.
To have a draw in progress, a semi-finalist from another live draw stands
in for him in the current tournament. A leak check against every replaced
original string passed before the files were written. `manifest.json`
holds the fake IDs the fake site (`tests/e2e/support/fake-tc.ts`) serves
them under.

**Decision:** a `tennis_tc` adapter over plain HTTP, public pages only,
configured with his profile link (no stored credential for now).

## SP-3: Commit Swimming (M2.1, 2026-09-27)

**Checked:** the owner signed in to `team.commitswimming.com` in a browser;
Claude read the parent pages and the data behind them (read-only; nothing
was changed in the account).

**How the site works:** a Meteor 2.15 single-page app. Pages load their data
over one DDP websocket (`/sockjs`), not REST or HTML, so the adapter reads the
same method results the pages do. Sign-in is Meteor accounts-password
(`Meteor.loginWithPassword`, with an optional 2FA code). URLs are
`/app/<team id>/…`; the team ID comes from the landing URL after sign-in.

**Page map (parent account):**
| Page | Route | Data (Meteor method or collection) |
|---|---|---|
| Dashboard | `/app/<team>/dashboard` | Subscriptions fill `users` (the athlete has `parentIds` = the parent's user ID, `roles: ["athlete"]`), `REventsStatic` (static events: distance, stroke, course, gender), `SuperTeams` (`accountId`) |
| Meet sign-ups | `/app/<team>/meets` | `getUpcomingMeetsForParent(team, page, perPage, null)` and `getPastMeetsForParent(…)` → `{meets, total, totalPages}`. Each meet: title, start/end (midnight in `meetTimezone`), course, venue, `invitedAthleteIds`, `commitments[]` (yes/no per athlete), `events[]` with `activeEntries[]` (athlete ID, optional `seedTime`) |
| Results, "My Team" | `/app/<team>/results/my-team` | Team leaderboards (other swimmers); not used |
| Results, "My Meets" | `/app/<team>/results/my-meets` | Team meet list; not used |
| One athlete's results | (component, no page of its own for parents) | `oneAthleteResultsPartialAccountAgnostic({athleteId, accountId, flatStartOnly, sortOrder, maxResults})` → `{results, events, splits, meets}`: every swim with `raceTime`/`seedTime` in **centiseconds**, place, heat, lane, `dqReason`, `staticEventId`; splits per leg; result meets with name, dates, course, city |
| Calendar | `/app/<team>/calendar` | `getMeetsForCalendar`, `getProgramsForCalendar`, `getScheduledPracticesForCalendar({…, parentView: true})` |

**Findings:**
- Jayden's history: 13 result meets, 41 swims, 32 splits, all short course
  metres (SCM); 19 meet sign-ups (8 with entries). Four 200 IM swims found.
- **Practices aren't published to parents:** the calendar's practice call
  returned nothing for the next 4 weeks. SWM-1 therefore uses the household
  calendar or manual repeating events (as the spec allows); the adapter
  doesn't fetch practices.
- **Duplicate uploads:** one weekend meet appears as three result meets with
  the same name and dates, each holding the same swims. The adapter merges
  result meets with the same name and dates, and drops a swim that repeats
  another's date, event and time.
- **Dates:** swim and result-meet dates are calendar dates stored at
  00:00 UTC (the site's own UI shows them a day early in time zones west of UTC; the
  sign-up dates confirm the UTC date is right). Sign-up meets run from
  midnight to midnight in `meetTimezone` (missing on older meets).
- **Splits** are per leg and add up to the race time. Some swims carry
  placeholder splits (null, 0, or the whole time on the last leg); the
  adapter drops a swim's splits unless every leg has a time and they add up.
- **Seed times** appear on some entries (`activeEntries[].seedTime`) and on
  results (`seedTime`); entries can have `suppressSeed`.
- **Team events:** sign-ups also include practices-with-sign-up, socials and
  team photos (no events list). They go on the calendar under swimming but
  not in the meet list.
- **Privacy:** the site sends the browser a lot about other families
  (names, addresses, medical notes, other swimmers' athlete IDs and
  commitments). The adapter's in-page extractor
  (`src/adapters/commit-swim/extract.ts`) returns only whitelisted fields
  for one athlete, so none of that reaches our worker, logs or database.
- The site offers a private calendar subscription link (`getCalendarToken`).
  Not used: meets come from the methods above with more detail, and the link
  would be one more secret.
- No public API or export was found (F-1).

**Fixture:** `tests/fixtures/commit-swim/athlete.json` is the extractor's
output with every name, venue, city and ID replaced, dates moved 104 weeks
earlier (weekdays kept), the time zone changed to America/Toronto, and
every time scaled with per-swim noise (duplicates kept identical). Places,
heats and lanes are random. It keeps the real shape: duplicate uploads,
placeholder splits, missing time zones, team events.

**Decision:** a `commit_swim` adapter that signs in with Playwright
(Chromium from the worker image; `playwright-core` pinned to the image's
version), waits for the dashboard's data, and runs the extractor in the
page. Three method calls per sync plus paging, 2 s apart.

## Other findings during M0

- **Firebase Hosting only forwards one cookie.** When Firebase Hosting
  rewrites to Cloud Run, it strips every cookie except one named
  `__session`. The spec's sign-in choice (Auth.js) uses several cookies
  (session, CSRF, OAuth state, PKCE), so sign-in would break behind Firebase
  Hosting. Recorded as spec concern F-14, with options.
- **Firebase Hosting is a CDN.** Responses with public cache headers can be
  cached at Google's edge. All pages and API responses must send
  `Cache-Control: private, no-store` (added to M1.1).
- **Docker Hub rate limits.** Base images come from `mirror.gcr.io` (Google's
  Docker Hub mirror) instead of Docker Hub.
- **Budget filtering by service** needs Google's billing service IDs, which
  couldn't be looked up. M0 has one project budget; the separate AI budget
  moves to M5 (after SP-6).

## Findings during the M1 rollout (2026-09-27)

- **Firebase Hosting kept the M0 home page for a year's worth of cache.**
  Next.js served the prerendered M0 page with `s-maxage=31536000`, so the
  CDN kept serving it after M1 deployed; deploying Cloud Run doesn't clear
  the Hosting cache. Fixed by releasing a new Hosting version (a release
  clears the cache). Every response now sends `private, no-store`, so this
  can't recur, but if a stale page ever appears again, a new Hosting
  release is the fix.
- **Google OAuth consent screen:** filling in the home page, privacy policy
  or logo, or listing a sensitive scope, sends the app to Google's
  verification, which needs a public home page (against AUTH-3). Publish
  unverified with only `openid` and `email`; the calendar scope is asked for
  at connect time (F-6). `infra/README.md` has the exact steps.
- **Secret Manager values:** pasting into `--data-file=-` and pressing Enter
  stores a trailing newline; use `read -rs V && printf '%s' "$V" | …`.
