# Plan: An event belongs to whoever it names, else whoever made it
Status: draft (2026-10-24), with [spec.md](spec.md).

Order: emails on People and the sync rule first (the visible fix for the
family's Google Calendar), then the hub's own forms and Cookie.

## 1. What the owner does
| # | Step | Needed for |
|---|---|---|
| O-1 | Add each parent's Google email under Settings → People. | OW1 in production |
| O-2 | After the next household sync, look over a few no-name events and check they're their creator's. | Done |
| O-3 | Install the TestFlight build and add an event on the phone. | OW2 |

## 2. Spikes
| # | Question | How | Blocks |
|---|---|---|---|
| SP-1 | Does Google return `creator.email` for events another parent made on the shared household calendar? | Read a few production household events (read only) and look at `creator`. | OW1 |

## 3. Milestones
| # | What | Spec | PR |
|---|---|---|---|
| OW1 | `people.emails` (migration), email on Settings → People, `ownersFor` with family/everyone and creator, Google `creator` read into household sync. | OWN-1..3, OWN-5..8, OWNSEC | |
| OW2 | "Me" for the signed-in parent: calendar form on website and iPhone, Cookie's asker default, email suggestions' mailbox default. | OWN-4 | |
| OW3 | TestFlight build bump. | | |

## 4. Done when
- A household event a parent made with no name in the title shows as
  that parent's only.
- "Jayden tennis" made by a parent is Jayden's.
- A new event on the calendar screen is ticked for the parent adding it.
- Cookie adds an unnamed event for the parent who asked.

## 5. Status
Draft. Waiting on the owner's approval of intent, spec and plan.
