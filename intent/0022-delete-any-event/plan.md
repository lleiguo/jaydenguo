# Plan: Delete any calendar event
Status: approved (owner, 2026-10-18, in chat: "Approve intent 0022 with the defaults."), with [spec.md](spec.md).

Order: the server first (the website follows in the same PR), then the
iPhone app, then a TestFlight build.

## 1. What the owner does
| # | Step | Needed for |
|---|---|---|
| O-1 | Install the TestFlight build and delete, then restore, a source event on the phone. | DL2 done |

## 2. Spikes
None.

## 3. Milestones
| # | What | Spec | PR |
|---|---|---|---|
| DL1 | Server and website: `deleteEvent` for any event, household Off/Dry run in the hub only, Cookie's rule kept; one Delete with the confirm on the web; Settings → Deleted shows the source. Integration and e2e tests. | DEL-1..7 | #164 |
| DL2 | iPhone: Delete on every event with the confirm; Deleted shows the source. TestFlight build bump in its own PR. | DEL-2, DEL-5 | #165, build 19 #166 |

## 4. Done when
- On production, a school or tennis event deleted on the website is gone
  from every view, stays gone after the next sync, and comes back from
  Settings → Deleted.
- The same works on the phone (O-1).

## 5. Status
Approved 2026-10-18 with the defaults (household deletable in the hub with the switch Off; Cookie keeps her rule; Skip stays). DL1 built: `deleteEvent` deletes any event; the web event screen has one Delete with the confirm (`src/domain/delete-confirm.ts`); Settings → Deleted shows the source. As built: Cookie has no delete tool, so nothing changed for her; a household event deleted while the switch is Off or Dry run stays in Google after it goes On, using `onSince` in the household sync setting (spec §3). DL1 merged (#164). DL2 merged (#165): the event sheet has Delete on every event with the website's wording (`DeleteConfirm` in HubKit), and Settings → Deleted shows the source; a UI test deletes a feed event and undoes it. TestFlight build 19 uploaded 2026-10-18 (bump #166); next = 20. Deployed 2026-10-18 (main a7456c5, revision web-00144-n6d; smoke test passed). Left for the owner: delete and restore a source event on the website and on the phone (O-1); Claude didn't, since it is real data.
