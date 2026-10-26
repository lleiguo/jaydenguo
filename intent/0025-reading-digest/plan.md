# Plan: Today's mail, summarized and read aloud
Status: approved (owner, 2026-10-25, in chat), with [spec.md](spec.md).

Order: the server first (the job, the summaries, the API), so the digest
can be checked against real mail on the website's API and the eval before
any screen exists; then the schedule; then the app; then Cookie's listen
mode, which only reads what the job stored.

## 1. What the owner does
| # | Step | Needed for |
|---|---|---|
| O-1 | Approve intent, spec and plan; answer the intent's questions or keep the defaults; M-1..M-6. | everything |
| O-2 | In Gmail: create the label `Hub/Read` and a filter or two that apply it (e.g. the school's newsletter). In Settings → Sources, add `Hub/Read` to the email source's labels. Optionally write the "about us" line in Settings → Mail. | MD1 in production |
| O-3 | `terraform apply` for the `mail-digest` schedule. | MD2 (the 06:30 run and notification) |
| O-4 | Install the TestFlight build; for two or three mornings, play the digest and check the to-dos against the real emails. | MD3, MD4 |

## 2. Spikes
| # | Question | How | Blocks |
|---|---|---|---|
| SP-M1 | How much mail does the allow-list let through each day, and how much is routine? | One worker run in production over the last 7 days that counts messages per day and per sender domain only (no subjects or text logged). If more than ~20 a day, recommend labels only (MS-3). | MD1 defaults |
| SP-M2 | Are Flash's to-dos and newsletter picks good enough? | The eval's made-up emails first; then the owner reads the first real digest beside the emails (O-4). Pass bar in spec §4. | MD1 |
| SP-M3 | How long does the spoken digest take to make, and what does it cost? | Make it for a 6-email fixture day with the server voice; time it and record the cost. Under 10 s to start playing is the target; else stream it per email. | MD3 (MA-2) |

## 3. Milestones
| # | What | Spec | PR |
|---|---|---|---|
| MD1 | **The digest on the server.** Tables and migration; the `mail` kind; `mail:digest` job (query, checks, summarizer with routine, to-dos, people, topic, newsletter); link to suggestions; retention and Clear history; the cap and Costs line; the API (§3.3) and OpenAPI; labels-only switch, the `Hub/Read` hint and the "about us" field in Settings; eval script. Run by the daily sync and refresh. | MD-1..8 (except the 06:30 push), MS, MT-1..3, MG-1..2, MN, MSEC | one |
| MD2 | **The 06:30 schedule and notification.** Terraform scheduler job; the push (MA-4, MT-4's overdue count) only from that run. | MD-1, MA-4, MT-4, §3.6 | one (touches `infra/`) |
| MD3 | **The app.** HubKit; the Today card; the Mail screen (to-dos, groups, chips, routine row, earlier days, refresh); Approve on a linked suggestion; Play with the mini player and background audio; `POST /mail/audio`; the notification switch and one-time switch-on; tapping the notification opens the Mail screen. | MD-5, MD-6, MT-2..4, MG-3, MA-1..3 | one (server audio route + iOS) |
| MD4 | **Listen mode.** `mail_digest`, `mail_todo_done`, `email_read` by message ID; prompt lines; Cookie eval cases; the app follows her place across turns (server-side cursor). | ML-1..6 | one |
| MD5 | **Review and release.** Security review addendum; TestFlight build bump in its own PR; the plan's Status. | MSEC | two small |

Each milestone ships with the [ship](../../.claude/skills/ship/SKILL.md)
procedure. MD2 can wait for O-3 without blocking MD3 or MD4.

## 4. Risks
| Risk | What we do |
|---|---|
| The digest is noisy (TeamSnap, receipts). | MD-4 routine folding; SP-M1; labels only (MS-3). |
| A wrong to-do or date is trusted. | The Gmail link on each summary; the eval; the owner's check (O-4). |
| Gmail search misses mail when a run is skipped. | Each run reads from the last successful run (up to 48 h back), deduped by message ID. |
| The spoken digest is slow to start. | SP-M3; stream per email if needed; the phone's voice as fallback. |
| Old app builds and a new notification kind. | `mail` is opt-in, as `cookie` and `swim` were (0009, 0023). |

## 5. Estimate
About 5–6 working days: MD1 2, MD2 0.5, MD3 1.5–2, MD4 1, MD5 0.5.

## 6. Status
| Task | Status |
|---|---|
| O-1 | done 2026-10-25: approved, defaults kept. |
| MD1 | merged and deployed 2026-10-25 (#186); migration 0038 applied in production. The first real digest comes with the next email sync; the owner's check is O-2, O-4. |
| MD2 | merged and deployed 2026-10-25 (#188); the 06:30 schedule waits for the owner's `terraform apply` (O-3). |
| MD3 | merged and deployed 2026-10-25 (#190); TestFlight build 24 (#191) uploaded 2026-10-25. The owner's phone check is O-4. |
| MD4 | built 2026-10-25 on `cookie/0025-md4-listen`. |

**As built (MD1, 2026-10-25):**
- *Where it runs.* The digest runs inside the email source's sync, on the
  mail that sync already fetched (spec §3.1), after the suggestions, so
  each summary links its suggestion. `mail:digest` is a sync of the email
  source; MD2 schedules it and adds the push. No `mail_runs` table: the
  sync run is the run (spec §3.2).
- *Data.* Migration `0038_mail_digest`: `mail_items`, `mail_todos`, and
  the kind `mail` (opt-in). Retention and Clear history clear both;
  Cookie's monthly spend counts the digest; Costs page line "Mail digest".
- *Settings.* On the email source in Settings → Sources: the `Hub/Read`
  hint, "Morning read: labelled mail only", and the "about us" line. No
  separate Settings → Mail page.
- *API.* `GET /api/v1/mail`, `POST /api/v1/mail/refresh`,
  `POST /api/v1/mail/items/{id}/read`, `PATCH /api/v1/mail/todos/{id}`.
  Audio comes with MD3.
- *Tests.* 11 integration tests (`mail-digest.test.ts`): once per email,
  context and no body kept, 48 h and labels only, the suggestion link, a
  hostile email, routine and newsletters, the day's limit, the cap and a
  failing model, the spend, read and ticked, retention; and the email sync
  end to end through the fake Gmail.
- *Eval (SP-M2, made-up mail).* `scripts/mail-digest-check.ts`: 10 emails
  (field trip, practice change, library books, receipt, a 7-item
  bulletin, a Chinese tennis email, a hostile one, snacks, fees, a
  furnace visit). After two prompt fixes (things to bring to an event are
  to-dos; a newsletter's summary covers only its picks): 10/10 twice,
  people and topic 9/10 (the jersey receipt is tagged to the child),
  about US$0.03 a run. The owner's real-mail check is O-4.

**As built (MD2, 2026-10-25):**
- *Schedule.* Cloud Scheduler job `mail-digest` (`mail_digest_schedule`,
  default `30 6 * * *`, home time zone) starts `mail:digest`. It needs the
  owner's `terraform apply` (O-3); until then, the digest is built by the
  05:00 daily sync and pull to refresh, with no notification (M-6).
- *Notification.* After its sync, `mail:digest` sends kind `mail` to
  every phone that has it on: "Today's mail", "N emails, M to do[, K
  overdue]". New mail is mail summarized since the last morning
  notification (at most a day back), routine mail not counted; nothing new,
  nothing sent; one a day. Pull to refresh never notifies. The app turns
  the kind on and opens the Mail screen from it in MD3; builds before that
  never receive it (opt-in).
- *Tests.* One more integration test (`mail-digest.test.ts`): nothing new
  sends nothing; the counts with a routine email and an overdue to-do; a
  rerun the same morning sends nothing more. `terraform validate` passes.

**As built (MD3, 2026-10-25):**
- *Server.* The day's script (`GET /api/v1/mail/speech`) and one part as
  speech (`GET /api/v1/mail/speech/{part}`), in place of
  `POST /mail/audio`. The script is the intro, each readable email by
  topic, "and N others", and the open to-dos, written from what's stored.
  Speech uses Cookie's voice and her switches (spoken answers, 80% of the
  cap); each part's cost goes in `mail_speech` (migration 0039, numbers
  only), counted toward the cap and on the Costs line. Fixed in passing:
  `POST /mail/items/{id}/read` is declared 204, as it answers. The seed has
  today's mail (three emails, two to-dos) for the app and its tests.
- *App.* Today shows the mail card ("2 emails, 2 to do", Play) when there
  is mail today or an open to-do. The Mail screen opens from the card,
  More → Today's mail and the notification (`jaydenguohub://open/mail`).
  It shows the to-dos (tick for both parents; due, overdue in red), today
  by topic (summary, newsletter's other items, the linked suggestion with
  Approve, Open in Gmail), "Also came in (N)", the earlier days folded,
  person chips, and pull to refresh (reads the email source). Summaries on
  screen count as read. The player reads the parts one after another
  (back, pause, next, stop; it stays on the last part when done). It keeps
  playing with the screen locked, with the lock-screen controls, and keeps
  the day's audio on the phone. The build turns "Today's mail"
  notifications on once. Clear history and sign-out remove the audio.
- *Tests.* Integration: the script and a spoken part (cost row, 404 for
  an unknown part, 409 with spoken answers off). HubKit: 7 mail tests
  (grouping, the card, chips, the suggestion, the queue, the day's audio,
  the route) and decoding of `getMail` and `getMailScript`. UI
  (`MailTests`, against the seed server): card → list → tick and untick a
  to-do; Play through the five parts, back, stop.

**As built (MD4, 2026-10-25):**
- *Tools.* `mail_digest` reads today's mail one email at a time from what
  the digest stored, in the spoken digest's order (topic, then time), with
  the email's open to-dos and pending calendar suggestion; filters by day,
  person, topic and sender words. `move` is "start", "next" or "same"
  ("same" gives the email just read again, for "tell me more", "add that"
  and "mark that done"). Past the last email: the open to-dos, then that's
  all. One email per call rather than three (spec §3.4): she reads them
  aloud one at a time. Reading one marks it read for that parent.
- *Her place* (ML-6) is a row per conversation in `mail_listen_cursors`
  (migration 0040: the order of item IDs and the position, nothing of the
  mail), kept 30 minutes.
- *Tell me more* (ML-3): `email_read` takes `mail_item_id` and looks for
  that email by its subject and sender over the days since it came,
  instead of a new Gmail lookup by message ID; no worker change.
- *Add that* (ML-4) is `suggestion_apply` with the email's suggestion, as
  0008. *Mark that done* (ML-5) is `mail_todo_done`, only when the question
  asks, ticked as "Cookie".
- *One step at a time.* The prompt only says to call `mail_digest` with
  move "same" first; that result says which tool comes next and with
  which id. Found in the eval: a prompt line naming both steps made Gemini
  stall until the round timed out ("add that" failed every time).
- *Budget.* The two tools and their prompt lines add about 1,260
  characters, sent only with an email source; the prompt budget (0007
  TOOL-15) goes from 15,000 to 16,500 (spec §1).
- *Tests.* 5 integration tests (`assistant-mail.test.ts`): offered with
  the email tools; one at a time and next across questions, a new
  conversation and after 30 minutes from the top; filters and marked read;
  tell me more; mark done only when asked. Cookie's eval gains 6 cases
  (read, next, tell me more, in Chinese, from a sender, add that) and
  `--only <from>-<to>` for a run of follow-ups.
- *Eval (2026-10-25, gemini-3.8-flash).* The six listen cases pass (one
  "from Coach Sam" run lost to a stall, passing on rerun). Whole set: 66/77
  answerable right (86%), nothing made up, no unasked changes, US$0.40;
  `main` the same evening: 59/71 (83%). Both lose 11–12 questions to the
  model not answering within the round's timeout (about 22 s, two
  attempts) on unrelated questions: an existing problem, not the mail
  tools.
