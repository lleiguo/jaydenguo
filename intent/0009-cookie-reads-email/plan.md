# Plan: Cookie reads an email when asked
Status: approved (owner, 2026-10-03, in chat), with [spec.md](spec.md).

Order: the server path end to end first (tool, worker, follow-up), so it
can be tried from the website's API and the eval before the app shows it;
then the app; then the review and a TestFlight build.

## 1. What the owner does

| # | Step | Needed for |
|---|---|---|
| O-1 | Approve the spec and plan; answer R-1 if summaries should leave history sooner than other answers. | everything |
| O-2 | A Gmail source with an allow-list (Settings → Sources) and Gmail connected on the Accounts page. In progress 2026-10-03. | R2 in production |
| O-3 | Install the TestFlight build after R3; ask about a real school email or two. | R3 |

## 2. Spikes

| # | Question | How | Blocks |
|---|---|---|---|
| SP-R1 | Does a Gmail search of "allow-list ∧ the question's words" find the email a parent means, or are the words too loose? | Against made-up messages in the fake Gmail (unit), then once in production with the owner's real allow-list, reading only subjects in the worker's own run (nothing logged or kept). If words miss, search the allow-list for the last N days and let the model pick from subjects first. | R2 |
| SP-R2 | How long from the question to the summary in production? | Time 3 real reads: question → worker start → Gmail → model → follow-up. Expect 20–40 s. | R3 (the "checking" wording) |

## 3. Milestones

### R1: The request (≈ 1 day)
| Task | Description | Spec | Done when |
|---|---|---|---|
| R1.1 | `assistant_email_reads` table and migration; `followup` turn mode. | §3.3 | Migration generated; integration test of a row's life. |
| R1.2 | `email_read` tool: the checks (email source, limits), the row, starting the job, the "checking" line. Prompt lines. | ERD-1..3, ERD-6, §3.1 | Integration tests with the scripted model: started, no source, over the limit, one per question. |
| R1.3 | `waiting` on the ask response and on turns; OpenAPI. | §3.4 | e2e test; `openapi.json` regenerated. |

### R2: The worker reads and summarizes (≈ 1.5 days)
| Task | Description | Spec | Done when |
|---|---|---|---|
| R2.1 | Gmail search for a read: the allow-list's query with the words, `from`, `newer_than`; 5 at most; `senderAllowed` again on each. | ERD-2..4, ERSEC-4 | Unit tests; fake Gmail returning a non-allowed sender. |
| R2.2 | The summarizer: Flash, structured (pick, summary, others), no tools, in the question's language. | ERD-4, ERD-5, ERSEC-2 | Unit test of the schema; integration with a scripted model, including a hostile email. |
| R2.3 | Job `assistant:email <id>`: the follow-up turn (answer, `email` source with the Gmail link, cost), the row's outcome, the failure line, the notification kind `cookie` to the asker's phones. The daily sync closes reads stuck pending. | ERA-1..3, ERA-5, ERA-6, ERSEC-1, ERSEC-5 | Integration tests: found, none, several, failure, no email text in any row, notification to the asker only. |

### R3: The app (≈ 1 day)
| Task | Description | Spec | Done when |
|---|---|---|---|
| R3.1 | HubKit: `waiting`, the follow-up turn, the `email` source link. | §3.4 | HubKit tests against fixtures. |
| R3.2 | "Checking the mail…" under the answer; asking for turns until the follow-up; the bubble after a spoken question, read aloud if on screen; the notification kind in Settings; tapping it opens the chat. | ERA-1..4, §3.5 | UI test with the stand-in model and a fake read. |

### R4: Review and release (≈ 0.5 day)
| Task | Description | Spec | Done when |
|---|---|---|---|
| R4.1 | Eval cases over made-up emails. | §3.6 | Pass bar: nothing made up, the right email. |
| R4.2 | Security review addendum. | ERSEC | Findings fixed or accepted. |
| R4.3 | TestFlight build 9. | — | Uploaded. |

## 4. Risks

| Risk | What we do |
|---|---|
| The search words miss the email the parent means. | SP-R1; fall back to listing the allow-list's recent subjects for the model to pick from. |
| A worker run fails silently and the chat waits. | ERA-5: the app stops waiting after 3 minutes, the daily sync closes stuck reads, and a failure line is written whenever the job knows. |
| A long email costs more than expected. | The text sent is capped at 8,000 characters (the adapter's `MAX_TEXT`); 5 candidates at most. |
| An old app build doesn't know the new notification kind. | Only phones that registered for `cookie` receive it; builds before R3 never do. |

## 5. Estimate

About 4 working days: R1 1, R2 1.5, R3 1, R4 0.5.

## 6. Status

| Task | Status |
|---|---|
| O-1 | done 2026-10-03: approved; R-1 kept as written. |
| R1–R3 | built 2026-10-03 on `cookie/email-read`; not merged. |
| R4.1–R4.2 | done 2026-10-03 (below). |
| R4.3 | build number 9 set; upload after merge. |
| SP-R1 | made-up mail done (below); the production check with the owner's allow-list waits for Gmail (O-2). |
| SP-R2 | waits for production. |

**As built (2026-10-03):**
- *Request (R1).* Migration `0029_assistant_email_reads` (the table and the
  `followup` turn mode) and `0030_notification_kind_cookie`. `email_read`
  is one of the email tools (offered once there is an email source),
  refused without an enabled one, after one per question, or past 10 an
  hour. The ask response and turns carry `waiting`.
- *Old app builds (found in review, F-1).* The API sends no new values in
  existing lists. A follow-up is mode `text` plus `followup: true`; the
  email source is kind `hub` plus `email: true`. The notification kind
  `cookie` is opt-in (`OPT_IN_KINDS`): never listed, never a default; the
  app turns it on once and shows its own switch. Build 8 sees the summary
  as an ordinary answer "From Field trip on Friday".
- *Worker (R2).* `assistant:email <id>` searches the allow-list narrowed by
  the parent's words; if that finds nothing, the allow-list's mail over
  the same days (10 emails, 1,500 characters each) for the model to pick
  from. Flash summarizes with a structured call: pick, summary, others.
  The follow-up turn carries the cost. The daily sync closes reads still
  pending after 30 minutes. Locally `EMAIL_LLM=fake` stands in for the
  summarizer.
- *App (R3).* "Checking the mail…" under the answer, in the chat and the
  bubble; the store asks for turns every 4 s until the summary arrives (3
  minutes at most) and adds it in place. After a spoken question the
  bubble stays up 45 s; if it or the chat is on screen when the summary
  arrives, she reads it aloud. The summary's subject is a link to Gmail.
  `jaydenguohub://open/cookie` (the notification's target) opens the chat.
- *Tests.* Unit (the query, the schema), integration (13 new: the request,
  the summary and no email text kept, the wider search, a hostile email,
  failure and the daily close, the limits, the notification to the asker
  only), e2e (ask → worker → follow-up through the fake Gmail, in under
  5 s locally), HubKit (waiting, follow-ups), UI
  (`testReadingAnEmailFollowsUp`; all 11 Cookie UI tests pass).
- *Eval (R4.1).* `scripts/email-read-check.ts`: the summarizer over four
  made-up emails (one hostile), six questions in English and Chinese,
  one with no match: 6/6, US$0.015. Cookie's eval: four reading questions
  and two that mustn't read, all pass; the email suggestion cases (68–73)
  still pass.
- *Review (R4.2).* [security-review.md](security-review.md): F-1 fixed;
  three accepted risks.
