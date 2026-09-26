# Intent: Jayden's schedule and progress hub (jaydenguo.com)
Author: Jayden's parent (lleiguo). Status: approved (2026-09-26).

## Problem
Jayden (9) trains and competes in tennis and swimming, plays soccer and hockey,
and attends math, Chinese and fitness classes on top of school. His schedule is
spread across club sites, tournament and meet sites, Veracross, Google Classroom,
the school calendar and messages from coaches. Nothing shows it all in one place,
so clashes are spotted late or missed, and it takes real effort to know what is
coming up next: who he plays, which events he swims, what homework is due.

## Proposed outcome
One private site at jaydenguo.com where a parent can see everything and act on it:

- **One calendar** combining all sports, classes, school timetable and school
  closure dates. Clashes are highlighted and can be fixed by drag and drop.
- **Tennis:** training schedule, upcoming tournaments, draw and opponent,
  head-to-head history, the opponent's recent results, and a predicted outcome
  for each match.
- **Swimming:** training schedule, upcoming meets and entered events, results,
  personal-best progression for each event over time (e.g. 200 IM), and a
  forecast of where his times are heading.
- **Soccer and hockey:** schedule only.
- **Technique review:** paste a link to a video hosted elsewhere (e.g. YouTube,
  Google Photos) for any sport and get an AI review of what is good, what is
  not, and what to work on next. No direct video upload.
- **School:** daily class schedule (Veracross), school calendar, and Google
  Classroom homework and quiz results in one place.
- Data refreshes automatically every day, and the parent can also trigger a
  refresh on demand (all sources or one). Changes made on the site show up
  straight away.
- **History is kept:** every calendar event (past and future) is stored
  permanently, as is every submitted video link and its AI review, so progress can be looked back on over the years.
- **Connected accounts:** the parent can enter logins for the sites the data
  comes from (club sites, results sites, school portals, YouTube, Google
  Photos) on the site, and they
  are stored securely and used only by the sync jobs.

## Affected users and systems
- Users: the parent (primary). Possibly the other parent, and later Jayden.
- External sources (read-only):
  - Tennis results, draws and opponents: Tennis Canada's tournament site
    (tc.tournamentsoftware.com, Jayden's player profile), with the parent's login.
  - Swim meets, entries and results: Commit Swimming team app
    (team.commitswimming.com, "my team" results).
  - Schedules come from several places: the shared household calendar (managed
    by hand by the parent), emails from coaches and clubs, and club apps
    (TeamSnap, Spordle and others).
  - School: Veracross (parent account), Google Classroom (Jayden's student
    account), and the school calendar.
- New systems: website and hosting on jaydenguo.com; a backend database for
  events, results and video-link history (videos stay with their host); an
  encrypted store for source-site credentials; daily and on-demand sync jobs;
  and an LLM for video review and match/time forecasts.

## Constraints
- It holds a child's personal data (schedule, locations, school records, video
  links),
  so the site must be private behind login. No public pages about Jayden.
- Use only access the family already has. Read school and sports data with the
  parent's own accounts or official exports/feeds. No scraping that breaks a
  site's terms of use.
- Credentials for source sites are encrypted at rest, never shown back in
  full on the site, never written to logs, and can be updated or removed at any
  time. Where a source offers sign-in with an access token (e.g. Google OAuth),
  use that instead of storing a password.
- Nothing is deleted automatically: calendar events are kept forever, and
  video links and reviews are kept until the parent deletes them.
- Videos are never uploaded to or stored on the site, only linked. Videos can
  stay private: the site reads them through the parent's connected YouTube or
  Google Photos account, and only fetches a video long enough to analyse it.
- Predictions and technique feedback are advice, not coaching fact. Label them
  as such and show what they are based on.
- Keep running costs low (a family project, not a business).
- Must work well on a phone, since it will mostly be checked on the go.

## Assumptions (defaults until the parent says otherwise)
- Fixing a clash by drag and drop changes only this calendar. Nobody is
  notified and nothing is rebooked with a club.
- Only the parent logs in at first. The design leaves room to add another
  parent later with view-only or edit access.
- Events sync one way out to the family's Google Calendar, and this can be
  turned off.
- Linked videos are sent to Claude for analysis, and nothing is kept after
  the review.

## Open questions
1. Which Google account holds the shared household calendar, and which inbox
   gets the coach and club emails? The sync needs to read both.
2. Jayden's Classroom account is a school-managed student account. The school
   may block third-party apps from connecting to it. If so, is a guardian
   summary email or manual entry an acceptable fallback?
3. Which activities use which club app (e.g. TeamSnap for soccer, Spordle for
   hockey)? Are there others besides these two?
