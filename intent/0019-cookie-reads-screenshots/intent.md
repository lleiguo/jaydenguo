# Intent: Cookie reads a screenshot or pasted text
Status: draft (2026-10-17). Drafted by Claude from the owner's request.
Owner: Jayden's parent (lleiguo).

"does cookie currently support pasting a screenshot or text to create a
calendar event or generate a summary" … "let's implement them" (2026-10-17,
after Claude listed three pieces: images in Cookie's chat, longer pasted
text, and sharing to Cookie from other apps).

## Problem
Coaches, clubs and other parents send times and places in WhatsApp groups,
WeChat and texts. The hub can't read any of those (iOS lets no app read
another app's messages), so a parent copies the details into Cookie by
hand. Today that only half works:

- **Images: not at all.** The ask API takes typed text or a recording
  (0007 LIM-3); the chat has no way to attach a photo.
- **Pasted text: 500 characters at most** (0007 LIM-3). A forwarded
  schedule or a long group message is refused as "that question is too
  long".
- **Pasted text can't ask to add.** She adds an event only when the
  question's own words ask for it (0008 ADD-2). Words like "schedule" in
  a coach's message would count as the parent asking, which is wrong;
  the parent's words and the message they pasted need to be told apart.
- **No way in from other apps.** The share extension only takes video
  links ("Review in Hub", 0004 EXT-3).

## Proposed outcome
A parent hands Cookie a screenshot or a message, from her chat or from any
app's share sheet, and she adds what it describes to the calendar or says
what it says.

- **In her chat.** A photo button next to the text field: pick up to 3
  images from Photos, or paste an image or a long text. Add a few words
  ("add this", "what do I need to bring?") or none.
- **From any app.** The share sheet gains "Ask Cookie" for images and
  text: WhatsApp, WeChat, Messages, Mail, Photos, a screenshot just taken.
  It shows what was shared and three choices: **Add to calendar**,
  **Summarize**, or a box to ask something else. Her answer, and any
  events added with their Undo, show in the same sheet.
- **Add to calendar.** She reads the date, time, place and who it's for,
  and adds it as she does for a spoken request (0008 ADD-3..7), saying
  back what she added. A shared schedule can hold several events: she adds
  up to 5 from one share, all in one answer with one Undo (question 1).
  Anything missing (whose it is, which day) she asks about and adds
  nothing, as today.
- **Summarize.** A few sentences: who it's from, what it says, and any
  dates, times, places and things to bring or do.
- **No words at all.** A picture or paste with nothing typed gets a
  summary and, if it describes an event, the question "Add it to the
  calendar?". She never adds without being asked.
- **Not here.** Reading WhatsApp or WeChat automatically (no way exists on
  the iPhone that keeps the account safe; see the 2026-10-17 chat). PDFs
  and other files. Changing or removing an existing event from a
  screenshot. Cookie on the website (0007 CK-8 still holds).

## Constraints
- **What's shared is data, never an instruction** (0007 CSEC-6). Only the
  parent's own words (typed, spoken, or the button they tapped) can ask
  her to add. Text inside a picture or a paste can't.
- **Privacy.** A screenshot of a group chat holds other people's names,
  numbers and words. It goes to Gemini on Vertex AI to be read, as voice
  clips do (0007 K-1), and isn't stored: not in the database, the logs or
  her history (question 2). The web tools are off for a question with
  something shared, so none of it can reach a search.
- **Cost.** An image is a few hundred to about 1,500 input tokens to the
  model she already uses; a question with three screenshots costs well
  under a cent. It counts against Cookie's monthly cap (0007 LIM-5).
- **iPhone only**, like the rest of Cookie.

## Open questions (defaults in brackets)
1. How many events from one share? [Up to 5, in one answer with one Undo.
   One per question (0008 ADD-1) would mean asking again for each match
   of a tournament schedule, and she can't see the picture again (2).]
2. Keep the picture or pasted text in her history? [No. The turn shows
   "a screenshot" or "pasted text (1,240 characters)" with her answer.
   Nothing someone else wrote is kept, matching voice clips (0007
   CSEC-2). The cost: "add the second one too" a minute later can only
   use what her answer said.]
3. How long can a paste be? [8,000 characters, the same cap as a web page
   or an email she reads (0007 TOOL-12, 0009).]
4. Shared from another app: answer in the share sheet, or open the app?
   [In the sheet. A share extension can't reliably open its app, and
   staying in WhatsApp is quicker. The turn is in her history either way.]
