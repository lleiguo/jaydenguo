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
| MD1 | built 2026-10-25 on `mail/md1-digest`. |

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
