# Intent: Full-screen video and follow-up questions on a review
Status: draft (2026-10-27). Drafted by Claude from the owner's request.
Owner: Jayden's parent (lleiguo).

"for video review, can the video be maximized? also can I ask a specific
question for review, e.g. "review the forehand stroke technique", and can I
ask follow up question after the initial review?"

"Yes, draft an intent for a full-screen player in the app and follow-up
questions on a review."

## Problem
- **The iPhone player is small.** It sits in the review page as a 16:9
  box in a list row (0004 IVID-2, 0003 PLAY-3). Turning the phone sideways
  turns the whole page; there's no way to fill the screen with the video
  and still have slow motion, frame steps and the review's points.
  The website already has the browser's own full-screen button.
- **A specific question works only up front.** The note ("what to look
  at") goes to Gemini with the video (0001 VID-3, 0006), but it can't be
  changed or added to once the review is made.
- **No follow-ups.** A review is one Gemini answer. Asking "was his elbow
  high at 0:42?" means a new review of the same video. Cookie can read a
  review's points (0007 TOOL-6) but not the video, so it can't check
  anything new.

## Proposed outcome
- **Full screen in the app.** A button on the player opens the video full
  screen, upright or sideways. The speed buttons, frame steps, the strip of
  points and the current point stay on screen. Closing it returns to the
  review at the same moment.
- **Ask about a finished review.** Under the review, on the website and in
  the app: a box to ask a question about the same video ("look at his
  forehand", "was his elbow high at 0:42?"). Gemini watches the video again
  with the review and the earlier questions in mind, and answers in a few
  sentences, with times that jump the player like the review's points.
- **A thread per review.** Questions and answers stay with the review, in
  order, and the next question sees the earlier ones.
- **The note says it's for questions too.** The form's note keeps working
  as now; its label says a specific question can go there.
- **Not here.** Full screen on the website (the browser has it already);
  questions to Cookie that watch the video; asking about a review whose
  video copy was deleted or never saved; changing the review itself from
  an answer; sound.

## Constraints
- Gemini still gets the video inline from the saved playback copy (0003
  PLAY-1, 0014 WVR-3); no new cloud resources or Terraform (0006).
- Each question is a Gemini call with the video, so it costs about as much
  as the review did. The costs page (0002) counts it with the review.
- Answers are AI feedback, not a coach's assessment, framed for his age,
  like the review (VID-3).
- The playback copy stays private (PLAY-2); nothing new leaves the app.
- The iPhone parts need a TestFlight build.

## Open questions (defaults in brackets)
1. How many questions per review? [10. Enough for a conversation, and caps
   the cost at about 10 reviews' worth.]
2. Longest question? [500 characters, like the note.]
3. Should the review's points update when an answer corrects them? [No.
   The answer stands under the review; the review stays as Gemini first
   wrote it.]
4. Full screen sideways only, or both ways? [Both: it follows the phone.]
