# Plan: "Accepted" once he's in the main draw, and the list behind it
Status: approved (owner, 2026-10-16, in chat: "approve, defaults"), with [spec.md](spec.md).

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
| A1 | Server and web: "Accepted" label, Friday re-reads, draw check, `tennis_entry_list` table (migration 0033), entry API and page, push. | ACC-1..6 | #138, fix #141 |
| A2 | iPhone: "Accepted" and the entry screen; TestFlight bump separate. | ACC-1, ACC-5 | #139, bump #140 |

## 4. Done when
- On a Friday with a list out, the Tennis page says "Accepted" for each
  main-draw entry by the next 2-hour run, and tapping it shows the same
  main draw as the site.

## 5. Status
Approved 2026-10-16 with the defaults. A1 (#138) and A2 (#139) merged and
deployed 2026-10-16; TestFlight build 15 uploaded. On production the
Tennis page shows TTC-Langley U9 Mixed as "Accepted". Its list was read
before the deploy, so #141 reads lists for accepted entries that have none
kept (at most every 12 hours); the 05:05 sync keeps it too.

Left for the owner: Terraform apply for the Friday schedule (O-2; until
then one 10:00 run); install build 15 (O-3).
