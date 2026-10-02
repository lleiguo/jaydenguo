# Intent: Cookie, a voice-first family assistant in the app
Status: approved (owner, 2026-10-02, in chat: "spec and plan looks good,
let's start the implementation"). Drafted by Claude from the owner's
request. Open questions answered 2026-10-02 by keeping the defaults in
spec §6.
Owner: Jayden's parent (lleiguo).

"I'd like to build an AI assistant into the app, the name is 'Cookie',
which is our family dog … voice mode first, she can understand both
Mandarin or English, English and Mandarin can be mixed together."

## Problem
The hub holds the family's schedule, results, school days, videos and
costs, but getting an answer means opening the right screen and reading
it. On the go, with a phone in one hand, "when is swim practice
tomorrow?" or "who does he play on Saturday?" should be a question asked
out loud, not four taps. The family speaks Mandarin and English, often in
the same sentence, and ordinary dictation picks one language and garbles
the other. The hub also has nowhere to keep the small family facts that
are not calendar events or results (shoe sizes, a coach's name, who is
allergic to what), so they can't be asked about later.

## Proposed outcome
An assistant named Cookie, after the family dog, available from every
screen of the app.

### How she is reached
- **Her avatar is the button.** A round icon of Cookie, the same picture
  as the app icon, floats over every screen.
- **Press and hold to talk.** Recording runs while the icon is held and
  stops on release. Cookie answers out loud and shows the transcript and
  her answer as text.
- **Tap to type.** A tap expands the icon into a chat box for typed
  questions, with the conversation so far. Typed questions get text
  answers (no speech unless asked for).

### Language
- She understands Mandarin, English, and both mixed within one sentence.
  Mixing must not lower transcript accuracy: names, places and sport
  terms said in English inside a Mandarin sentence (and the reverse) come
  out right.
- She answers in the language she was asked in. A mixed question gets
  the main language of the question.
- The transcript of what was heard is always shown, so a mishearing is
  visible and can be corrected by typing.

### Character
- **Concise.** One or two sentences by default, the answer first. More
  only when asked ("tell me more").
- **Grounded.** Answers come from what she knows: the hub's own data and
  her memory. When she uses the web, she says so and names the source.
- **She does not make things up. She barks.** When she doesn't know, or
  what she found doesn't answer the question, she barks ("Woof!", with a
  bark sound in voice mode) and says in a few words what she couldn't
  find. A bark is never followed by a guess.

### What she can answer
- Anything about the family that the hub holds: the calendar and
  clashes, tennis (tournaments, entries, draws, opponents, results),
  swimming (meets, results, personal bests), school days and key dates,
  video reviews, people, costs. For every person in the hub, not only
  Jayden.
- Anything she has been told to remember (below).
- General questions that need the web (opening hours, a venue's address,
  a tournament's rules), through web search and reading a page.

### Memory
- **Told to remember:** "Cookie, remember that …" saves a family fact.
  She confirms what she saved in one line.
- **Used when relevant:** saved facts are looked up when a question
  needs them, not loaded into every question.
- **Visible and editable:** a Memory list in Settings shows everything
  she has saved, with when and by whom. Any item can be edited or
  deleted, and "Cookie, forget …" does the same by voice.
- **Recent conversation:** she keeps the last few turns so follow-ups
  work ("and the day after?"). Older turns are not sent with new
  questions.

### Tools and token use
- Cookie only has tools that are written down in the spec, each with a
  fixed name, inputs and output. Nothing open-ended (no free database
  queries, no general browser agent). The starting list:
  1. Look up hub data (calendar, tennis, swimming, school, videos,
     people, costs): read-only, one narrow tool per area.
  2. Search memory, save a memory, forget a memory.
  3. Web search.
  4. Fetch one web page as text (her "browser": read-only, no clicking,
     no forms, no sign-ins).
- Hub and memory tools come first. The web is used only when those can't
  answer, or when asked for.
- Hard limits per question, set in the spec: a small number of tool
  calls, at most one or two web lookups, capped page size, capped answer
  length. If the limit is reached without an answer, she barks.
- Her cost shows on the Costs dashboard (0002) as its own line, with a
  monthly cap.

## Proposed services (to be confirmed in the spec)
The recommendation is to stay on what the hub already runs: Google
Vertex AI in the hub's own Google Cloud project.

- **Speech to text and the answer, in one step: a Gemini Flash model on
  Vertex AI.** Press-and-hold produces a short finished clip, not a live
  stream, so the clip is sent as audio straight to the model. Gemini
  takes audio natively and handles Mandarin and English mixed in one
  sentence without being told the language first, which is where
  dictation engines that need one language picked (including Apple's
  on-device dictation) fall down. One call returns the transcript and the
  answer, which is also the cheapest shape: no separate transcription
  bill and no second round trip.
- **Why Flash, not Pro:** short questions over small tool results don't
  need the larger model, and Flash is faster and several times cheaper.
  The video reviews keep their own model.
- **Why not Claude:** Claude does not take audio in, so it would need a
  separate transcription service in front, and the hub's Claude quota on
  Vertex is still 0.
- **Why not a live speech-to-speech session (Gemini Live):** better for
  hands-free back-and-forth, but costs more per minute and is more to
  build. Press-and-hold doesn't need it. Worth revisiting if a
  hands-free mode is wanted later.
- **Speaking the answer:** Google Cloud text-to-speech with a voice that
  handles Mandarin and English in one sentence. The iPhone's built-in
  voices are free and private but switch awkwardly between the two
  languages; they are the fallback when offline or over budget.
- **Web search:** Vertex AI's Google Search grounding, plus a small page
  fetcher (new: the hub has none today) for reading one page.
- **Memory:** a new table in the hub's existing database, searched by
  the memory tool. No separate memory service.

The spec starts with a short spike: record 20 or so real mixed-language
questions from the family, and measure transcript accuracy and time to
answer before anything else is built. If Gemini's transcripts aren't
good enough, the fallback is Google's dedicated speech-to-text (Chirp)
in front of the same model.

## Affected users and systems
- Users: the owner and the other allow-listed parent. The children will
  talk to her on a parent's phone.
- iPhone app (0004): the floating icon, recording, playback, the chat
  box, the Memory list. Needs microphone permission.
- Backend: one new assistant route on `/api/v1`, the tool definitions, a
  memory table, cost tracking.
- New: text-to-speech, and Google Search grounding on Vertex AI.

## Constraints (carried from 0001 and 0004, still apply)
- Private: allow-listed accounts only. Cookie answers nothing to anyone
  not signed in.
- Read-only on the hub: Cookie can look things up but cannot move or
  delete events, enter tournaments, change settings or touch connected
  accounts. Her memory is the only thing she writes.
- She never sees source-site credentials, and no tool returns them.
- Recordings hold children's voices. Audio is sent for the answer and
  not kept afterwards, on the phone or the server.
- Data about the family stays in Google Cloud in Canada where the
  service offers it. Any service that can't run there is flagged in the
  spec for the owner to decide.
- Web searches go out to the public internet: search queries must not
  carry the children's names, school or address.
- Text from a web page is information, never instructions. A page can't
  make Cookie call a tool or save a memory.
- No third-party SDKs that send data elsewhere.
- Keep running costs low.

## Assumptions (defaults until the owner says otherwise)
- iPhone app first. The website gets the chat box (typing only) in the
  same intent, voice on the website later.
- No wake word and no always-on listening. She listens only while the
  icon is held.
- She saves a memory only when told to, never on her own from
  conversation.
- One shared memory for the family, not one per parent.
- Conversation text is kept so the chat box can show history, and can
  be cleared from Settings.
- The avatar reuses the app icon's artwork as it is; no new drawing.

## Open questions
1. Should Cookie be able to change things later (add an event, move a
   practice, start a refresh), with a spoken confirmation first? This
   intent keeps her read-only.
2. Should she also learn on her own (notice a fact in conversation and
   offer to remember it), or only when told?
3. Should the icon be on every screen, or hidden on some (the video
   player, Face ID lock)? Should it be draggable?
4. Are there things she should refuse to say out loud, since the
   children will hear her (costs, for example)?
5. Should the website get voice too, or is typing enough there?
6. How long should conversation history be kept: forever like the
   calendar, or a rolling window?
7. Which voice: a plain friendly one, or something more dog-like? And
   should the bark be a recording of the real Cookie?
