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
| Veracross | Parent portals usually offer a calendar subscription link for the school calendar. The daily timetable needs scraping either way. | **M4.2 (2026-09-27): no feed yet.** The school's full calendar sits behind a page passkey on its website; the owner chose to read the public "Key Dates at a Glance" list instead (`school_dates` adapter). Timetable: scrape (below). |

**Veracross, M4.2 (2026-09-27):**
- The school's website has a public calendar page with a "YYYY-YYYY Key
  Dates at a Glance" heading and a server-rendered `<ul>`: one `<li>` per
  date or range, e.g. `<strong>Monday, Dec. 21 - Friday, Jan. 8:
  </strong>Winter Break (No Classes)`. Dashes are written with and
  without spaces; month names are abbreviated with or without a dot. The
  weekdays let the parser check the year. It covers closures, Pro-D days,
  breaks and first/last days, but not other school events. Some items are
  for one campus only ("Jr. School Only", "Sr. School Only").
- The full school calendar and the athletics calendar are behind a page
  passkey (a password form on the school's site) given out on the Parent
  Portal. Not used: Claude doesn't enter passkeys, and the owner chose the
  public list.
- Parent portal (owner's screenshots): top menu My Children, Family
  Profile, Attendance, Directories, Menu. Under My Children, each child
  has Classes & Reports, Daily Schedule, Recent Updates, Upcoming
  Assignments and Student Files. The timetable is **Daily Schedule**
  (not mapped yet: needs a signed-in look). Upcoming Assignments and
  Classes & Reports are a possible F-5 fallback for homework and grades
  if Classroom is blocked.

**Veracross Daily Schedule page map (M4.2, 2026-09-28, signed in by the
owner in the browser pane; read with all text masked):**
| Part | Where | Gives |
|---|---|---|
| Page | `portals.veracross.com/<school>/parent/student/<student id>/daily-schedule?date=YYYY-MM-DD` (`&type=student`, the default; `type=school` came back empty) | Server-rendered HTML: a plain GET with the session cookies has every period. |
| Day | `h1.date-header` ("Monday, September 28"), `h2.rotation-day-header` (the rotation day's name) | The date and rotation day. A day without classes has no items. |
| Period | `.vx-schedule-item`, one per period, in order | `.item-time` start only ("8:30 am"; **no end times**); `.item-main-description` the class or block (with his homeroom code); `.item-subtitle` "teacher, teacher • room"; `span.item-type.class` for classes, `span.item-type.universal-block` for recess and lunch; `table.assignments` per period (empty on the day looked at). |
| Navigation | `a.day[href=…?date=]` for two weeks; previous/next-day buttons | Any date by the `date` parameter. |

Monday had 13 items (classes, homeroom twice, two recesses, lunch). End
times: each period ends when the next starts; the last gets the day's
most common period length. The student id is in the My Children links.
The sign-in flow (accounts.veracross.com → portal session) was not
inspected: the owner chose a generic browser sign-in, checked with "Test
connection" once the login is saved. "My Children" is drawn by a script
after load (`component/MyChildrenParent/…/load_data`); each child has an
`h4.vx-child-name` next to its links.

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

## SP-7: tournament search, entry lists and entering (M3b.1, 2026-09-27, public part done)

**Checked:** `tc.tournamentsoftware.com` signed out, from the owner's Mac,
page structure only (tags, classes, counts, labels of the site's own
filters). No names from entry lists went into the transcript or the repo.
About 40 requests, 2 s apart.

**Page map (public):**
| Page | Path | Gives |
|---|---|---|
| Tournament search (fragment, POST, `X-Requested-With`) | `/find/tournament/DoSearch` | 20 results a page (`Page=n`): ID, name, venue, start and end (`time[datetime]`), category tags, and an "Online Entry" button while entry is open. Filters: `TournamentExtendedFilter.StatusFilterID=2` (online entry open), `TournamentExtendedFilter.TournamentCategoryIDList[0]=7207` (Rookie), `TournamentFilter.PostalCode` + `TournamentFilter.Distance` (km: 5…1000), `TournamentFilter.DateFilterType=0`. No anti-forgery token needed. |
| Event list | `/sport/events.aspx?id=<t>` | Every event: `event.aspx?id=<t>&event=<n>` and its name. Names vary by organiser: "U10 (Orange Ball)", "U9 Orange Boys", "RT 9 - 12 (Green)". |
| Event page | `/sport/event.aspx?id=<t>&event=<n>` | Once draws are made, a `table.ruler` of draws (`draw.aspx?id=<t>&draw=<n>`, size, type). Until then, a `table.ruler` captioned "Entries (n)" (seen with both in Sept 2026; from Oct 2026 the list is gone once the draws are made, even before they're filled, and the Players tab says "No players found", so the jobs ask the signed-in account's `/individual-entry/<t>` page instead): per row, a status cell ("Maindraw", class `green elt1`; "Reserve list N", class `orange elt9998`), the player link (`player.aspx?id=<t>&player=<tournament player number>`) and seed. Before the acceptance list the rows have no status. |
| Tournament overview | `/tournament/<t>` | As SP-2, plus the entry link `/individual-entry/<t>`. |
| Entry form | `/individual-entry/<t>` | **Redirects to `/user/login`** when signed out. |

**Findings:**
- Acceptance lists and draws are public, so TEN-10 and TEN-11 need no
  login. His row is found by name (word order and case don't matter),
  then by his tournament player number once known.
- Rookie events are for U10 and younger; U9 orange events sit in Rookie
  tournaments, so the search filters on it.
- The search's distance is straight-line km from a postal code; drive
  time comes from a routing service (Google Routes API).

**Still to do (needs the owner):** the signed-in entry flow. The owner
signs in on the site in the Claude desktop app's browser pane (as for
SP-3); Claude reads the entry form's structure only and submits nothing.
Questions: which fields and steps the form has for one event, whether a
Rookie entry is free or goes to a payment step, and what the page shows
once an entry is in but unpaid. Then M3b.6 builds the registrar with the
stored login.

**Fixtures:** `tests/fixtures/tennis-tc/entries/*.html` are hand-built
from these structures with invented names and IDs (not recorded pages).

**Signed-in part, first look (2026-09-28):** the owner shared a
screenshot of a finished entry's "My entry" page (structure recorded here
only; its personal details are not). What it shows:
- A status badge ("Entered") and an entry number (`E` + digits).
- Sections filled in from the signed-in player's profile: Personal (name,
  birthdate with age, gender, email), Address (postal code, city,
  province, country, phone) and Sport (club, member ID). So an entry
  mostly means choosing events and confirming; the personal details come
  from the account.
- Events: one row per event entered (e.g. "U10 (Orange Ball)") with a
  "Withdraw" button.
- No payment line on this page for this entry.

**Signed-in part, the entry form (2026-09-28):** the owner signed in in
the desktop app's browser pane (Claude typed nothing) and Claude read one
open tournament's form (a "Rising Stars" BS10/GS10 event) without choosing,
ticking or submitting anything.
- Signed out, `/individual-entry/<t>` redirects to `/user/login`: form
  `form_login` posting to `/user` with `Login`, `Password`, a hidden
  `__RequestVerificationToken`, `ReturnUrl`, and the submit button
  `btnLogin`.
- Signed in, one page with three numbered sections and one form (`form0`,
  POST `/online-entry/IndividualEntry/SubmitEntry`, anti-forgery token):
  1. **My details:** contact and sport details from the account, each with
     a "Change" link; nothing to fill in. Hidden `TournamentCode` and
     `OrganizationPerson_Code` (the player).
  2. **Events:** "filtered by your gender and date of birth"; a select
     `EventDetails.SelectedEvents[0].EventID` whose options read
     "<event code> - <ball colour> $<fee>" (here one option, $45.00), value
     = the event ID. Required: "Please select at least one event."
  3. **Remarks:** optional `CommentDetails.Comments`.
  Then "I agree to the tournament regulations" (`DisclaimerAgree`, a
  YES/NO toggle; the regulations link opens the tournament information),
  and Submit / Back / Withdraw.
- **No payment step on the form:** the fee is only in the event's option
  text. What follows Submit (a payment page, or straight to "My entry" with
  "Entered") wasn't seen, because nothing was submitted.

**Decided (owner, 2026-09-28):** submit entries automatically; where the
site requires payment during registration, flag them "Payment required"
for the owner. Built in M3b.6. The page after Submit when a fee is due
hasn't been seen yet, so the registrar recognises payment generously (a
pay button or address, or unpaid wording) and flags anything it can't read
for the owner instead of calling it entered. The first real paid entry is
worth a look to tighten this.

## SP-5: Classroom access with Jayden's school account (M4.1, 2026-09-27, waiting on the owner)

**Built for the test:** the Accounts page has "Connect school account
(Classroom)". It asks Google for `classroom.courses.readonly` and
`classroom.coursework.me.readonly` (his classes, his coursework, his
submissions and returned grades) with the account chooser shown, so the
owner can pick Jayden's school account while signed in as himself. The
grant is stored as a separate Google credential, like any other
(CRED-2). Straight after consent the site reads his active class list and
keeps only a count, or Google's refusal word for word, on the credential
(`meta.classroom`); "Test connection" reads it again. If Google refuses
before a grant exists (the school blocks the app), the page shows
Google's error code, e.g. `admin_policy_enforced`. The project needs
`classroom.googleapis.com` enabled (`infra/apis.tf`).

**What to expect:** Google Workspace for Education treats users marked
under 18 differently: by default they can't grant access to third-party
apps the school's admin hasn't set as trusted, and Google shows an
"Access blocked" page (error 400, `admin_policy_enforced` or similar)
instead of the consent screen. If that happens, the blocked page's error
code goes into this section, and the owner picks a fallback (spec F-5):
1. ask the school's IT to trust the app by its OAuth client ID;
2. Classroom guardian email summaries, parsed from Gmail (needs M5's
   Gmail adapter);
3. manual entry.
If consent works, Google shows the unverified-app warning first (F-6);
continue through "Advanced".

**How the owner runs it:** after the M4.1 PR is deployed and Terraform is
applied, open Settings → Accounts → "Connect school account (Classroom)",
choose Jayden's school account (or "Use another account"), and consent.
Jayden's password is typed only on Google's page, never in chat.

**Result:** not run yet.

## SP-6: Gemini and Claude on Vertex AI (M5.1, 2026-09-28, partly done)

**Checked:** from the owner's Mac with Application Default Credentials in
project `jaydenguo`, a handful of tiny calls (well under $1 in total). No
video of Jayden was used: the video test used a 10 s synthetic ffmpeg
test pattern.

**Models listed in Model Garden (2026-09-28):**
- Gemini: the newest Pro is `gemini-3.1-pro-preview` (public preview,
  served from `global`); `gemini-2.5-pro` is the newest GA Pro; the newest
  Flash is `gemini-3.8-flash` (GA). All three answered from `global`.
- Claude: `claude-opus-5`, `claude-opus-5-5`, `claude-sonnet-5`,
  `claude-fable-5-1`, `claude-haiku-4-5` and older are listed.

**Claude is still blocked:** every Claude call fails with 429 "Quota exceeded
for aiplatform.googleapis.com/global_online_prediction_requests_per_base_model"
(base models `anthropic-claude-opus`, `-sonnet` and `-haiku-4-5`). Regional
endpoints (`us-east5`, `northamerica-northeast1`, `europe-west1`) answer 404
for Claude. **Owner step:** request a quota increase for
`global_online_prediction_requests_per_base_model` for `anthropic-claude-opus`
(IAM & Admin > Quotas; 10 requests per minute is plenty). Until then video
reviews can run in single-model mode with Gemini only; debate mode, email
suggestions and match explanations need Claude.

**Gemini video input works:** the video goes inline (base64) with
`videoMetadata.fps`, and structured output (JSON schema) holds. Measured
on `gemini-3.1-pro-preview`, 10 s at 1280×720:

| fps | video tokens | thinking tokens | answer tokens | time |
|---|---|---|---|---|
| 1 | 660 | 6,908 | 104 | 73 s |
| 5 | 3,300 | 2,428 | 454 | 35 s |
| 10 | 6,600 | 3,817 | 468 | 46 s |

So a video costs about **66 tokens per sampled frame**, and each call spends
more on thinking than on the video. A single call takes 30–75 s, so a debate
(five rounds, the two models in parallel) takes several minutes: fine for a
background job with a 30-minute limit.

**Cost per debate (estimate from the measured tokens):** a 20 s clip at 8 fps
is about 11k video tokens per Gemini call; Claude gets up to 60 frames at
768 px wide, about 26k image tokens per call, cached after the first round.
With list prices at build time (Gemini 3.1 Pro preview about $2 in / $12 out
per million tokens, thinking billed as output; Claude Opus 5 about $5 / $25,
cache reads a tenth of input), five rounds each come to about **$0.55 for
Gemini and $1.00 for Claude: $1.50–2.00 per debate**, inside the spec's
§8 range ($1.50–3.00), so §8 is unchanged. Single-model Gemini review:
about $0.15. Every call records its own tokens and cost
(`video_review_rounds`), so the real figure shows on the review page. The
prices live in `src/server/llm/pricing.ts`; check them against the Vertex AI
pricing page when the first bill arrives.

**AI budget:** `infra/budget.tf` adds a second budget ("hub AI monthly",
`ai_monthly_budget`, default 40) filtered on the Vertex AI billing service
(`C7E2-9256-1C43`). The Cloud Billing API isn't enabled in the project, so
the service list couldn't be read here. **Owner step:** after the first
Claude charges, check Billing > Reports grouped by service; if Claude shows
under a different service, add its ID to `ai_billing_services`.

**Still to do (needs the owner):** one real clip reviewed by both models
(O-9 clips), after the Claude quota is raised. That run happens in M5.7.
