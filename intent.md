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
- **Technique review:** upload a video or paste a link for any sport and get an
  AI review of what is good, what is not, and what to work on next.
- **School:** daily class schedule (Veracross), school calendar, and Google
  Classroom homework and quiz results in one place.
- Data refreshes automatically every day, and the parent can make changes on the
  site that show up straight away.

## Affected users and systems
- Users: the parent (primary). Possibly the other parent, and later Jayden.
- External sources (read-only): tennis tournament/ranking sites, swim results
  databases, club/team schedules for soccer and hockey, Veracross, Google
  Classroom, the school calendar, and the class providers' schedules.
- New systems: website and hosting on jaydenguo.com, a data store, daily sync
  jobs, video storage, and an LLM for video review and match/time forecasts.

## Constraints
- It holds a child's personal data (schedule, locations, school records, video),
  so the site must be private behind login. No public pages about Jayden.
- Use only access the family already has. Read school and sports data with the
  parent's own accounts or official exports/feeds. No scraping that breaks a
  site's terms of use.
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
7. How long should uploaded videos be kept, and is it OK to send them to a
   third-party AI service for analysis?
