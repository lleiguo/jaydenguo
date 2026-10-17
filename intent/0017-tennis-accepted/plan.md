# Plan: "Accepted" once he's in the main draw, and the list behind it
Status: draft (2026-10-16), with [spec.md](spec.md).

Order: find out why today's entry stayed "Registered" first, then the
server, then the iPhone app.

## 1. What the owner does
| # | Step | Needed for |
|---|---|---|
| O-1 | Approve these docs (answer the open questions, or keep the defaults). | A1 |
| O-2 | Terraform apply for the Friday schedule. | ACC-2 in production |
| O-3 | Install the TestFlight build. | A2 |

## 2. Spikes
| # | Question | How | Blocks |
|---|---|---|---|
| SP-A1 | Why did one entry stay "Registered" on 2026-10-16? List out late, hidden behind the draw, or a new label? | Read that entry's event page on the site (no sign-in) and its row in the database; save a scrubbed fixture. | A1 |

**SP-A1 (2026-10-16, evening): the list came out after 10:00.** The owner
named the entry: TTC-Langley U9 Mixed Rising Stars (Oct 25). Its event
page shows "Entries (41)": 10 "Maindraw" (him among them, class
`green elt1`), reserves 4–32, one "Exclude list" (`red elt9999`), and two
draws already made, listed above the entries. The labels are the known
ones, and the app's own parser and matcher read him as main draw
(`parseEventPage` and `findSelfRow` on the saved page). The 10:00 job
logged 1 entered and 2 reserve, and no job read the lists after that,
so the entry stayed "entered". ACC-2 (read again through Friday) fixes
it; ACC-3 still matters for the week the list goes away. Also: "Exclude
list" is new; `entryStatusOf` returns null for it, which reads as
"entered". A1 treats it as not in the draw ("Not accepted").

## 3. Milestones
| # | What | Spec | PR |
|---|---|---|---|
| A1 | Server and web: "Accepted" label, Friday re-reads, draw check, `tennis_entry_list` table, entry API and page, push. | ACC-1..6 | |
| A2 | iPhone: "Accepted" and the entry screen; TestFlight bump separate. | ACC-1, ACC-5 | |

## 4. Done when
- On a Friday with a list out, the Tennis page says "Accepted" for each
  main-draw entry by the next 2-hour run, and tapping it shows the same
  main draw as the site.

## 5. Status
Draft. Waiting on the owner's approval of intent, spec and plan.
