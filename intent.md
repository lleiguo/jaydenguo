# Intent: Jayden's schedule and progress hub (jaydenguo.com)
Author: Jayden's parent (lleiguo). Status: draft.

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
  comes from (club sites, results sites, school portals) on the site, and they
  are stored securely and used only by the sync jobs.

## Affected users and systems
- Users: the parent (primary). Possibly the other parent, and later Jayden.
- External sources (read-only): tennis tournament/ranking sites, swim results
  databases, club/team schedules for soccer and hockey, Veracross, Google
  Classroom, the school calendar, and the class providers' schedules.
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
- Videos are never uploaded to or stored on the site, only linked. The review
  depends on the link being viewable by the analysis service (e.g. public or
  unlisted).
- Predictions and technique feedback are advice, not coaching fact. Label them
  as such and show what they are based on.
- Keep running costs low (a family project, not a business).
- Must work well on a phone, since it will mostly be checked on the go.

## Open questions
1. Where does he compete? Which tennis (e.g. UTR, USTA, Tennis Canada) and swim
   (e.g. USA Swimming/SwimCloud, Swimming Canada) bodies hold his results?
2. How do schedules arrive today for each activity: shared calendar, club app
   (TeamSnap, SportsEngine, etc.), email, or PDF?
3. When a clash is fixed by drag and drop, should that only change our calendar,
   or also notify the coach or book with the club?
4. Does the school allow Google Classroom and Veracross access for a parent
   account through their APIs, or will data have to come from guardian emails
   or manual entry?
5. Who else needs to log in (other parent, grandparents, Jayden), and should
   they have view-only or edit access?
6. Should events sync out to the family's Google Calendar as well?
7. Is it OK to send linked videos to a third-party AI service for analysis?
8. Are the videos usually public/unlisted, or private (e.g. a Google Photos
   album shared only with family)? Private links may need your Google account
   connected so the video can be read.
