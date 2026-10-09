# Intent: Pull down to refresh his tennis entries
Status: draft (2026-10-09). Drafted by Claude from the owner's request.
Owner: Jayden's parent (lleiguo).

"on mobile app, I don't want to tap refresh, just want to pull down to
refresh, and that does not need to be a full sync, the on-demand refresh
should refreshes his entries, checks where he stands on each entry list,
refresh draw if it's out"

## Problem
- On the iPhone Tennis screen, pulling down only reloads what the app
  already has. Getting anything new from Tennis Canada means tapping
  "Refresh from Tennis Canada" (0004 APP-7).
- That button runs the full Tennis sync (0001 SYNC-2): his profile,
  results, draws, every opponent's history and the tournament search. It
  takes about 4 minutes, and it's refused for an hour after the last one
  (SYNC-5).
- What a parent wants on demand is smaller: is he entered, where does he
  stand on each list, and is the draw out.

## Proposed outcome
- **Pull down on the Tennis screen** checks Tennis Canada, then reloads.
- **The Refresh button stays** on the Tennis screen, on the iPhone and
  the web, and still runs the full sync (owner, 2026-10-09: "keep the
  refresh button for full sync on both mobile and web").
- **A quick check, not a full sync.** It reads his account's "My
  entries", reads the entry list of each upcoming tournament he's in
  (main draw, or reserve list and place), and looks for each draw due
  within the week.
- **When a draw is out**, his draw, his next opponent and the prediction
  come in too.
- **Quick.** Usually well under a minute, and the spinner stays until
  it's done.
- **Not here.** The 5 a.m. full sync, the Thursday, Friday and
  draw-watch jobs, and the Sources page's Refresh: they stay as they are.

## Constraints
- Polite to the site as before: one request at a time, 2 s apart.
- Only the worker reads the Tennis Canada login (0001 CRED-4).

## Open questions (defaults in brackets)
1. How often can a pull reach the site? [At most once every 5 minutes.
   Pulling sooner just reloads, with "Checked 2 min ago".]
2. "Refresh draw if it's out": what runs? [The first time a draw is seen,
   the full sync, as the draw watch does today, so opponents and the
   prediction come in. Once it's in, a pull re-reads only that draw (new
   results, next match) for tournaments under way.]
3. The Refresh button? Answered (owner, 2026-10-09): it stays on the
   iPhone and web Tennis screens and runs the full sync.
4. Does the quick check also look for new tournaments to enter? [No: the
   Thursday job and the 5 a.m. sync do that.]
