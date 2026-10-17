# Intent: "Accepted" once he's in the main draw, and the list behind it
Status: approved (owner, 2026-10-16, in chat: "approve, defaults"). Drafted by Claude from the owner's request.
Owner: Jayden's parent (lleiguo).

"when the acceptance list come out, typically Friday morning, and if
Jayden is on the main draw, not the reserved list, his status should be
"accepted", not "registered", when click into it, show the acceptance list
(with all players in the main draw)"

## Problem
The Friday job (0001 TEN-10, `tennis:acceptance`, 10:00) reads each
event's entry list and records "main draw" or "reserve list (place)". On
Friday 2026-10-16 the owner still saw "Registered" for a tournament after
the list was out ("for TTC-langley U9 mixed Rising Starts, the status
show "registered" but should be "Main Draw""). The logs show the 05:05
sync found 2 entered and 1 reserve, and the 10:00 job 1 entered and 2
reserve: one entry stayed "entered". The spike (plan SP-A1) found the
first cause below. The causes it checked:
- **Too early.** The list came out after 10:00, and nothing reads it
  again until Saturday's sync (or a pull on the iPhone, 0012).
- **Hidden.** From Oct 2026 the site hides the entry list once the draws
  are made; the app then keeps whatever it had ("entered"), and "My
  entries" only says "Entered".
- **A label the parser doesn't know** for main-draw players.

Also, the app shows "Main draw", where the owner thinks "Accepted", and
the entry list itself isn't kept: an upcoming tournament without a synced
draw links out to Tennis Canada, so there's no way to see who else got in.

## Proposed outcome
- **"Accepted".** Once he's in the main draw, the Tennis page (web and
  iPhone) says "Accepted" instead of "Registered" or "Main draw". Reserve
  stays "Reserve list (N)".
- **Read until it's out.** On Fridays the list is read again through the
  day until each of his events shows main draw or reserve.
- **In a draw = accepted.** When the list is hidden but his name is in the
  event's draw, he's accepted.
- **The acceptance list.** Tapping an upcoming tournament opens its entry
  page: his status, when the list was read, and every player in the main
  draw (him highlighted; players the app knows link to their page). The
  last list read is kept after the site hides it.
- **A push** when he's accepted (today only reserve → main draw sends one).
- **Not here:** entering, withdrawing, or the draw and predictions (TEN-11
  is unchanged).

## Constraints
- Polite to the site (SYNC-5): one request at a time, 2 s apart; the extra
  Friday reads touch only his events whose list isn't settled.
- Privacy: the list is other children's names and tournament player
  numbers. Keep only name, tournament player number, status and reserve
  place (as the draws already keep opponents' names); nothing in fixtures.
- The status stored stays `main_draw` (the label changes, not the data).

## Open questions (defaults in brackets)
1. Show the reserve list too, under the main draw? [Yes, with places,
   collapsed under the main draw; it's what tells you if he might get in.]
2. Friday re-reads: how often, until when? [Every 2 hours, 08:00–20:00
   Friday, only for events not yet settled; that's an `infra/` schedule
   change, so a Terraform apply by the owner.]
3. Push when accepted? [Yes: "Accepted: <tournament> (<event>)".]
