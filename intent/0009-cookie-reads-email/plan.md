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
| R1–R4 | started 2026-10-03. |
