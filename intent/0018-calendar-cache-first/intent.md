# Intent: The saved calendar first, on any connection
Status: approved (owner, 2026-10-16, in chat: "approve, defaults"). Drafted by Claude from the owner's request.
Owner: Jayden's parent (lleiguo).

"for calendar, can the app keep a local cached version, so if the network
is spotty or too slow or no connection, the app can just display the local
cache version"

Then, on the four points Claude suggested: "show the saved calendar first,
refresh in the background, fall back fast on slow networks, and keep the
saved copy usable across the weekly window change."

## Problem
The iPhone app (intent 0004) already keeps the last answer to each request
(OFF-1, `CacheMiddleware`), but the calendar only shows it after a request
**fails**:
- **Slow or spotty connections wait.** The calendar's request uses the
  system's 60-second timeout. On weak signal the screen stays blank (or
  shows a spinner) until the server answers or the minute runs out; only
  then does the saved copy appear.
- **The saved copy is never shown first.** 0004 §4.1 says "each store
  renders from the cache first, then the network", but `CalendarStore`
  goes to the network first.
- **The saved copy goes missing every Monday.** It is filed under the exact
  date range asked for, and the range starts on the Monday a week back. On
  a new week (or after moving to a far date) the range is new, nothing
  matches, and offline the calendar says "Couldn't load the calendar".

## Proposed outcome
- **Instant calendar.** Opening the Calendar tab shows the last calendar
  the phone saw straight away, on any connection.
- **Refreshed behind it.** The app asks the server at the same time and
  swaps in the new answer when it arrives; pull to refresh works as today.
- **Fast fallback.** If the server hasn't answered in a few seconds, the
  banner says the calendar is saved and how old it is ("Offline, updated
  2 h ago"), instead of a blank screen. A late answer still replaces it.
- **Saved across weeks.** The saved calendar is used whatever week it is;
  days it doesn't cover show as empty under the banner, not as an error.
- **Not here:** Today, tennis, swimming and other screens (they keep
  OFF-1 as it is); the website (its service worker never keeps data,
  NFR-5); changing events offline (still "You're offline", OFF-2).

## Constraints
- Privacy and sign-out stay as 0004 says (OFF-3, SEC-3): the saved
  calendar lives in the app's protected cache, out of backups, and is
  wiped on sign-out.
- No server or `infra/` change; iPhone app only, so a TestFlight build.
- Writes still need a connection (OFF-2): no queue of offline changes.

## Open questions (defaults in brackets)
1. How long before the app gives up waiting and says so? [8 seconds; a
   healthy 4G answer takes under 3 s (INFR-2).]
2. How much is saved? [The last range the calendar loaded: a week back to
   ten weeks ahead of the dates viewed, one copy, replaced on each
   successful load.]
3. Show anything while refreshing behind a saved copy? [No spinner; the
   banner appears only when the refresh is slow or fails.]
