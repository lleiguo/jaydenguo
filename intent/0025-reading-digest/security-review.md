# Security review: Today's mail (MD5, 2026-10-25)

Spec MSEC-1..6. I read the digest (`src/server/mail/digest.ts`), the
morning notification (`src/server/mail/notify.ts`), reading aloud
(`src/server/mail/speech.ts`), the Mail API (`src/server/mail/view.ts`,
`src/app/api/v1/mail/`), Cookie's mail tools
(`src/server/assistant/tools/mail.ts`, `email-read.ts`), the schema
(`db/schema/mail.ts`, migrations 0038–0040), the notification kinds
(`src/domain/notifications.ts`, `src/server/push/notify.ts`) and the
app's new code (`ios/HubApp/Features/Mail/`, `ios/HubKit/Sources/HubKit/Mail/`).
This adds to the reviews of [0007](../0007-cookie-assistant/security-review.md),
[0008](../0008-cookie-calendar-changes/security-review.md) and
[0009](../0009-cookie-reads-email/security-review.md).

## Found and fixed

| # | What | Fix |
|---|---|---|
| F-1 | **The new notification kind broke the installed app's notification settings.** MD1 added `mail` to `OPT_IN_KINDS`, and the device settings listed it in `more`. Builds 20–23 decode `more` into a fixed list of kinds (the generated enum has no catch-all), so from MD1's deploy (2026-10-25) their device settings calls (`/devices/current`) failed to decode: the Notifications screen showed no switches and the one-time switch-ons did nothing. Push itself kept working. 0023's NTF-SEC1 only covered builds before `more` existed. | `more` never gains a kind (`MORE_KINDS`: cookie, tennis_result, swim). Kinds added after build 23 go in a new field `extra`, whose kind is a plain string, so no later kind can break a build. Build 25 shows `extra`'s switches for the kinds it knows. Build 24 already turns `mail` on by itself, with no switch until build 25. Integration test of both lists; HubKit test that a kind it doesn't know decodes in `extra` and fails in `more`. |
| F-2 | **`POST /mail/items/{id}/read` was declared 200 but answered 204**, so the generated client had no `noContent` case. | Declared 204 (fixed in MD3). |
| F-3 | **Two steps in one prompt line made Gemini stall** until the round timed out ("add that" failed every time in the eval). An availability problem, not a leak. | The prompt names one step; the `mail_digest` "same" result says the next (MD4). |

## Checked, nothing to change

| Area | What was checked | Result |
|---|---|---|
| The email isn't kept (MSEC-1) | `mail_items` holds the sender's name and address, the subject, the summary, newsletter lines, to-dos, people and topic; no body. Log lines hold source IDs and counts (`mail digest`), the error's name only on failure. `mail_speech` and `mail_listen_cursors` hold numbers and IDs only. Integration test: no sentence of the email's body is in any row. | OK |
| An email can't give orders (MSEC-2) | The summarizer is a structured call with no tools; its output is stored as text and shown. To-dos it writes are never acted on: only a parent ticks them, or Cookie when the parent's own question asks (`mail_todo_done` checks the question's words, as `suggestion_apply` does). Integration test with a hostile email; the eval's hostile email gave a summary and no to-dos. | OK |
| What Cookie reads aloud | The spoken parts are written by the server from stored rows; `GET /mail/speech/{part}` takes a part name or an item ID, never text, so the voice can't be made to say anything else. | OK |
| Retention (MSEC-3) | The daily sync deletes summaries after 14 days and to-dos after 30 (or a day after they're ticked). Clear history deletes both and the phone's audio. Sign-out removes the audio. Integration tests. | OK |
| Only parents (MSEC-4) | Every Mail route uses `api()` (signed-in parents and their phones); Cookie's tools only run for a signed-in parent's question. | OK |
| Cost (MSEC-5) | Summaries and spoken parts count toward Cookie's monthly cap; at the cap new mail is listed by subject and the phone's voice reads; 40 summaries a day; 120 spoken parts an hour per parent. | OK |
| Only the worker opens Gmail (MSEC-6) | The digest runs inside the email source's sync in the worker; the web service only starts it (`POST /mail/refresh` → `requestRefresh`, with its hourly limit). | OK |
| Allow-list | The digest reads only what the email source's sync fetched, which is checked against the senders and labels (0009 ERSEC-4); labels only (MS-3) narrows it further. | OK |
| The phone's audio | Kept per day in the app's caches with file protection "complete unless open"; other days are removed when a day is played. | OK |
| The notification | Its text ("Today's mail", counts) is fetched by the extension, not sent through Apple (PUSH-2); only phones that turned the kind on get it; one a day. | OK |

## Accepted risks (owner, 2026-10-25: M-1..M-6 in the spec)

1. **Summaries are kept for 14 days** (M-1), in the database and its
   nightly backup.
2. **A hostile email can make its own summary or to-dos wrong** (M-2). It
   can't make the hub act; the Gmail link is on every summary.
3. **More family context goes to Gemini** to condense newsletters (M-4).
