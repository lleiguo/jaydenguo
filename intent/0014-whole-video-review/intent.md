# Intent: Review the whole video
Status: draft (2026-10-11). Drafted by Claude from the owner's request.
Owner: Jayden's parent (lleiguo).

"i want to review the whole length"

## Problem
- A review looks at 2 minutes at most (0001 plan M5.3, `MAX_REVIEW_SECONDS`).
  A longer video needs a segment marked when the review is made, else it
  fails: "The part to review is 252 s long. Mark a segment of 120 s or
  less." (a 4-minute swim, 2026-10-11).
- The segment can't be changed afterwards, so "Try again" fails the same
  way; the only way out is to delete the review and start again.
- The cap exists because the clip goes to Gemini inline (under 19 MB) and
  the same clip is the playback copy (0003 PLAY-1), and because Gemini is
  asked for at most about 400 frames (`geminiFps`).

## Proposed outcome
- **No segment means the whole video**, up to 10 minutes. A segment is
  still optional, for when only one part matters.
- **The same detail as today for a few minutes of video.** A 4-minute
  swim is looked at about 3 times a second (today's 2-minute swims: 3).
- **The player shows the whole reviewed video**, with the cited times on
  it as now.
- **"Try again" on today's failed review works** once this ships.
- **Not here.** Changing the segment of an existing review; videos over
  10 minutes; sound.

## Constraints
- Gemini still gets the video inline, so no new cloud resources or
  Terraform (0006).
- The worker has 2 GiB and a 30-minute timeout; downloads stay capped at
  400 MB (VID-2).
- Gemini is billed per frame it reads, so a long review costs more; the
  costs page (0002) shows each review's cost.

## Open questions (defaults in brackets)
1. Longest video reviewed whole? [10 minutes. Longer ones still need a
   part marked, with a message saying so.]
2. How many frames may Gemini read for one review? [900 (today 400): a
   4-minute video at 3 a second, 10 minutes at 1 a second, roughly 2.5×
   today's cost for the longest.]
