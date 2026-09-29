# Intent: a native iPhone app for the hub
Status: draft (2026-09-28). Drafted by Claude from the owner's request in
chat; the owner approves or edits it.
Owner: Jayden's parent (lleiguo).

"I'd like to develop a native iOS app … I want all the same
functionalities, but tailored to mobile use."

## Problem
The hub is mostly checked on the go (0001 constraints), but it is a website.
On a phone that means opening a browser tab, waiting for a cold start,
signing in again after cookies are cleared, and pinching around pages
built for a desktop first. The site can't tap you on the shoulder when a
clash appears, a draw comes out or a sync fails, and there is nothing on
the home or lock screen that answers "what's next for Jayden today?".
Spec 0001 §1.1 deferred a native app until the web version was in use;
it now is, for every slice.

## Proposed outcome
A native iPhone app (SwiftUI) that does everything the site does, laid out
for one hand and a small screen, plus what only a native app can do:

- **Same features as the site:** calendar with clashes and moving events,
  people filters, tennis (tournaments, entries, draws, opponents, win %,
  results), swimming (meets, results, PBs, progression and forecasts),
  school (today at school, key dates), video reviews with the player,
  email suggestions, sources and refresh, connected accounts, people,
  costs, deleted items and sessions.
- **Tailored to the phone:** an agenda-first calendar with swipe actions
  and long-press to move; a "Today" screen; native charts; sheets instead
  of pages for edits; pull to refresh; works one-handed.
- **Notifications:** new clashes, a draw or next opponent, an entry that
  needs paying, a finished video review, a sync that keeps failing, a new
  email suggestion. Each kind can be switched off.
- **Home and lock screen widgets:** today's schedule and the next event.
- **Share to the hub:** share a Google Drive or Google Photos video from
  another app to start a review, without copying links around.
- **Works offline for reading:** the last synced calendar and results can
  be read with no signal (e.g. at a pool or rink); changes need a
  connection.
- **Face ID lock** for a child's data on a phone that others may pick up.

The website stays and keeps every feature. The app is a second client of
the same backend, not a replacement.

## Affected users and systems
- Users: the owner, and the other allow-listed parent. iPhone only (no
  iPad or Android layouts in this intent).
- Backend: the existing `/api/v1` JSON API, which spec 0001 §1.1 designed
  for this. It needs a sign-in method that works outside a browser, push
  notifications, and API routes for the few pages that today read the
  database directly.
- New: an Apple Developer account, Apple Push Notification service (APNs),
  TestFlight for installing the app.

## Constraints (carried from 0001, still apply)
- Private: only allow-listed Google accounts, no public pages about
  Jayden. The app is not listed publicly on the App Store.
- Credentials for source sites stay write-only; the app can set or test
  them, never read them back.
- No analytics, ad or crash-reporting SDKs that send data to third
  parties.
- Data about Jayden stays in Google Cloud in Canada. Notifications must
  not carry his personal details through Apple's servers.
- Keep running costs low.

## Assumptions (defaults until the owner says otherwise)
- iPhone only, iOS 18 or later.
- Installed through TestFlight (internal testers), not the public App
  Store.
- Videos for review still come from Google Drive or Google Photos; the app
  does not upload from the iPhone's own photo library (see open question 1).
- Same allow-list and same data as the website; nothing app-only.

## Open questions
1. Many clips will be filmed on the iPhone and live in Apple Photos, not
   Google Photos. Should the app be allowed to upload a clip from the
   iPhone's library for review? That reverses 0001's "no direct upload"
   (0003 already keeps a playback copy on the server).
2. Is TestFlight fine (builds must be refreshed every 90 days), or is an
   unlisted App Store app worth the extra review step?
3. Which notifications should be on by default?
