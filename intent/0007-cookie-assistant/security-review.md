# Security review: Cookie, her routes and her tools (K7.2, 2026-10-02)

Plan K7.2, spec CSEC-1..8, MEM-1, MEM-5, MEM-6 and LIM-1..6. A manual read
of `src/server/assistant/`, `src/domain/assistant.ts`, the routes under
`/api/v1/assistant`, the Terraform added in K5, and the app's Cookie code
(`ios/HubApp/Features/Cookie/`, `ios/HubKit/Sources/HubKit/Assistant/`),
on top of [0001's review](../0001-jayden-hub/security-review.md) and
[0004's](../0004-ios-app/security-review.md), which still cover sign-in,
sessions and the app. Each area was read in the code; the tests named are
the ones that prove it.

## Found and fixed in this review

| # | What | Fix |
|---|---|---|
| F-1 | **Error logs could carry words (CSEC-7).** A failed lookup or route logged `String(err)`. A database error's message quotes the failed query's values, so a question, an answer or a memory could reach the logs. | Cookie's routes (`quietApi`) and tool failures log only the error's kind (its name and database code), never its message. Unit test with a message that holds a "secret". |
| F-2 | **A page could talk her into a search.** After reading a page (a link typed in the question), a planted instruction could have her look at the hub and then search the web for what she found. Names and the private words were already refused, but a time and a venue were not. | No search in a question that read a page. Integration test: the page's order is refused, nothing is searched. |
| F-3 | **IPv6 forms of private addresses.** The page fetcher refused `::ffff:127.0.0.1` but not the same address written `::ffff:7f00:1`, nor NAT64, 6to4 and Teredo forms that carry an IPv4 address. Node prints mapped addresses with dots, so this wasn't known to be reachable; it is now refused outright. | Every IPv6 form that carries an IPv4 address is refused. Unit tests for each form. |
| F-4 | **A path ID that isn't an ID reached the database,** which answered with an error (a 500 and an error log) instead of "not found". | `idOf` on every `{id}` route: 404. e2e test. |
| F-5 | **A crash while recording left the clip on the phone** until iOS cleared its temporary folder. | Leftover recordings are deleted at the next launch. |
| F-6 | Not security, found on the way: with Vertex AI not set up (production today, until Terraform is applied) a question was a 500. | It is now "Cookie can't answer right now", like any other model failure. |

## Checked, nothing to change

| Area | What was checked | Result |
|---|---|---|
| Signed-in only (CSEC-1) | All eleven operations go through `api()`: a session cookie with the Origin check, or the app's device token. The route-list e2e test, built from Next's manifest, proves each refuses an anonymous request. | OK |
| Whose data | History and speech are per account (someone else's turn is a 404, tested). Memory, settings and "Clear history" are the family's, by design: any allow-listed parent can see and change them. | OK |
| The clip (CSEC-2) | On the server it exists only in the request's memory: decoded, checked (type, 1 MB, 30 s read from its own header), sent to the transcriber, dropped. The header parser was read for out-of-range reads: every length is checked before use. No row or log line holds the clip (integration test). On the phone: a protected temporary file, deleted when sent, cancelled or left over (F-5). | OK |
| Speech (CSEC-2) | Made on request from the turn's stored answer, returned with `no-store`, kept nowhere, never cached on the phone. Rate-limited (30 in 5 minutes) and refused at 80% of the cap, so it can't run up a bill. | OK |
| Grounding (CHR-3) | The server, not the prompt, decides whether an answer stands: each claimed source must be backed by a tool that ran successfully in this question. A tool error doesn't count. | OK |
| Tool results can't give orders (CSEC-6) | Saving and forgetting need the question's own words (`asksToRemember`, `asksToForget`), one each per question, never after a web tool. A page is read only if its link is in the question itself. A search can't follow a page (F-2). Tested with a hostile page and a hostile event title. | OK |
| Web search (CSEC-3) | A separate call that sees only the query: no conversation, no hub data. Queries over 120 characters, or holding a person's name or a private word, are refused. Its answer goes to the family as it is and never back to her model (Google's terms, spec §4.7), which also means a search result can't give her orders. | OK |
| Page fetch (CSEC-4) | HTTPS on port 443, a named host, no sign-in details in the link; the address is checked at connection time (no gap between checking and using); every redirect is checked again, three at most; 5 s, 1 MB, text only; no cookies, nothing about the hub in the request. | OK |
| No credentials (CSEC-5) | No tool reads the credential, session or email tables; an integration test runs every hub tool over seeded data and looks for credential, token and inbox text in the results. Memory refuses passwords, PINs and card-length numbers (MEM-6). | OK |
| Logs (CSEC-7) | One line per turn: ID, outcome, tool names, timings, token counts. Tested: no words, no clip. Errors: see F-1. | OK |
| On the phone (CSEC-8) | Nothing from Cookie is cached: the chat, settings, memory and speech calls are live-only. Links under an answer open only if `https`. The fixture-clip switch (`-HubCookieClip`) exists in debug builds only. | OK |
| Microphone | Recording runs only while her button is held or between two taps on the chat's mic button; leaving the app stops it. The system's permission text says why. | OK |
| Limits (LIM-1..5) | Per question: 4 rounds, 5 tool calls, 1 search, 1 page, 25 s. Per account: 20 questions in 5 minutes; 300 a day in all; the monthly cap. Checked before any model is called. | OK |
| Infrastructure | The web service account gains `roles/aiplatform.user` only. No new secret, bucket or public endpoint. `ASSISTANT_LLM=fake` is refused on Cloud Run. | OK |
| Third parties | No new packages on the server or the phone. Google (Vertex AI, Text-to-Speech, Search grounding) is the only place data goes; no Anthropic or other key. | OK |

## Accepted risks (owner to confirm)

1. **A child holding the phone can ask her anything a parent can,** and can
   tell her to remember or forget a fact. Memory is visible and editable
   in Settings, and a forgotten fact can be restored for 30 days.
2. **Words leave Canada.** Questions, clips, answers and what the tools
   returned go to Gemini's `global` endpoint, and answers to Text-to-Speech,
   as the owner accepted (spec K-1). Search queries go to Google and are
   kept for up to three days.
3. **A search can name a place.** The filter keeps out the people's names
   and the words on "Never send to the web"; it can't know a venue is
   private unless it is on that list (plan O-5). In the eval a weather
   question was searched with the home city in it, which she takes from
   the home time zone. Add the city to the list if that is unwanted;
   weather questions then get a bark.
4. **A search's answer is Google's** and isn't checked by her grounding
   rule (spec K-12, still open).
5. **A clip's length is taken from its own header.** A clip made by hand
   could claim to be short; the 1 MB limit still bounds it to a few
   minutes and well under a cent.
6. **She speaks on a silent phone** when asked out loud, so an answer can
   be overheard. "Spoken answers" can be switched off.
7. **The request size is checked from its `Content-Length`.** A signed-in
   client that hides it can make the server read a larger body before
   the size check refuses it. Only the two allow-listed accounts can.
