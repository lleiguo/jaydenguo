# Plan: A push for each step of his tennis and swimming, every suggestion and every clash
Status: approved (owner, 2026-10-19, in chat: "approve, defaults"), with [spec.md](spec.md).

Order: the APNs key first (nothing arrives without it), then the server,
then the iPhone app.

## 1. What the owner does
| # | Step | Needed for |
|---|---|---|
| O-1 | Approve these docs (answer the open questions, or keep the defaults). | P1 |
| O-2 | In the Apple Developer account (team 5NQND46R49): Keys → a new key with Apple Push Notifications service; download the `.p8`. Add it as a version of the `apns-key` secret with `read -rs` (never in chat or the repo; see `infra/README.md`). | NTF-1 |
| O-3 | Set `apns_key_id` and `apns_team_id` in the Terraform variables and apply. | NTF-1 |
| O-4 | Install the TestFlight build; check Settings → Notifications shows the new switches. | P2 |

## 2. Spikes
| # | Question | How | Blocks |
|---|---|---|---|
| SP-S1 | Does Commit Swimming show his heat and lane before a meet? | As built: the sync logs the field names (never values) of his entries as a warning, "SP-S1 entry fields: …"; read it from the next Commit Swimming sync's log in production. If heat and lane fields are there, NTF-S2 is a follow-up PR; if not, it's dropped. | NTF-S2 |

## 3. Milestones
| # | What | Spec | PR |
|---|---|---|---|
| P0+P1 | One PR. `push:test` job and a runbook line in `ios/README.md`; new kinds and migration 0036, the `more` field, registered, tennis results, swim entered / results, clash reminder, backfill, labels and targets; the SP-S1 log. Heat sheet (NTF-S2) waits on SP-S1. | NTF-1, NTF-T1..T5, NTF-S1, NTF-S3, NTF-C3, NTF-SEC1..2 | |
| P2 | iPhone: new switches (from `more`, replacing the fixed Cookie switch), the one-time switch-on, the clash screen (`Route.clash`, `jaydenguohub://open/clashes/<event id>`) from a clash push, new targets; build bump and TestFlight separate. | NTF-C1, NTF-C2 | |

## 4. Done when
- The owner's iPhone shows the test push with its real text.
- Over the next tournament and meet, each step (registered, accepted,
  draw, result; entered, results) shows on the phone once, and a tap
  opens the right screen.
- A clash push opens the clash screen, and Accept or Skip there resolves
  it.

## 5. Status
Approved 2026-10-19 with the defaults. P0+P1 built 2026-10-19; P2 next.
Nothing arrives on the phone until the APNs key (O-2, O-3).
