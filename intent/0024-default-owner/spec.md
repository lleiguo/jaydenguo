# Spec: An event belongs to whoever it names, else whoever made it
Status: draft (2026-10-24). Written by Claude from [intent.md](intent.md).

Read with 0001 (CON-1, CON-5), 0008 (ADD-3, GCW-6), 0009 (EMS), 0019
(SHA-3) and 0020 (TWO-2, BACK-2). IDs here: OWN (whose an event is),
OWNSEC (security).

## 1. What changes in earlier specs
- **0001 CON-1** "a source's default owners and title rules set them at
  sync": for a source that knows who made an event (the family's Google
  Calendar), the creator comes before the default owners (OWN-2).
  Other sources stay as they are.
- **0001 CON-5** (a parent's change wins) stays as it is.
- **0008 ADD-3** "with no person named she asks": she gives it to the
  asker instead (OWN-4). "Everyone" and names work as today.
- **0008 GCW-6, 0020 TWO-2** (everyone: no name in the Google title)
  stay as they are: the hub's own writes keep the hub's owners on read
  (BACK-2 and the assistant override), so no creator rule touches them.
- **0019 SHA-3** "not clear from either: she asks": the asker's (OWN-4),
  unless the material says it's for another person.
- **People setting (PR #43)** gains a Google email per person (OWN-6).

## 2. Requirements

### 2.1 Whose an event is (OWN)
| ID | Requirement | Acceptance criteria |
|---|---|---|
| OWN-1 | A name wins. | Title rules with an owner and people named as whole words in the title decide, as `ownersFor` does today. "Jayden tennis" made by a parent is Jayden's only. |
| OWN-2 | Else the creator, for the family's Google Calendar. | A household event with no rule or name match is owned by the person whose Google email equals Google's `creator.email` (case-insensitive). Made by a parent: that parent's only. |
| OWN-3 | Fallback when the creator is unknown. | No `creator.email`, or it matches no person: the source's default owners, then the primary person (today's rule). |
| OWN-4 | Made in the hub: the signed-in parent. | The calendar form (website and iPhone app) ticks the person whose email equals the signed-in user's email, instead of the primary person; with no match it ticks the primary person as today. Cookie, with nobody named, gives the event to the asker and reads it back ("Adding: dentist, Tuesday 3 pm, for [name]"); with no match for the asker she asks, as today. Email suggestions with nobody named go to the person whose Gmail it came from, else as today. |
| OWN-5 | Everyone only when said. | An event is everyone's only when every person is ticked, Cookie was told "everyone" (ADD-3), or the title has "family" or "everyone" as a whole word. The household source's default owners are not used when OWN-2 finds a creator. |
| OWN-6 | People have Google emails. | Settings → People shows an optional email for each person (website; the iPhone app shows it read-only if it shows People). Saved lower-case and trimmed; the same email can't be on two people; a bad address is refused with a plain message. |
| OWN-7 | Existing household events. | The next household sync works out owners for every event in its window with OWN-1..OWN-5, so an upcoming "Dentist" a parent made moves from everyone to that parent. Events with an owners override (CON-5) don't change. Events made in the hub or by Cookie don't change. |
| OWN-8 | It shows. | The event's details show whose it is as today; the history records an owners change from sync as a sync change. |

### 2.2 Security (OWNSEC)
| ID | Requirement | Acceptance criteria |
|---|---|---|
| OWNSEC-1 | Emails are private. | People's emails are only in the database and shown only to signed-in parents; they're never in logs, push messages, Cookie's answers or the repo. Fixtures and tests use `example.com`. |
| OWNSEC-2 | Only the creator field counts. | The owner comes from Google's `creator.email`, never from text in the event's description or title other than OWN-1's names. |

## 3. Design
- **Schema.** `people.emails text[] not null default '{}'`, with a check
  that values are lower-case; uniqueness across people is checked on
  save (`src/server/people.ts`). `pnpm db:generate --name people-emails`.
- **Domain.** `ownersFor(title, mapping, people, creatorEmail?)`: rules
  and names (OWN-1); then "family"/"everyone" → all people (OWN-5); then
  the person with `creatorEmail` (OWN-2); then `mapping.owners`, then
  empty (= primary) (OWN-3). `people` carries `emails`.
- **Google read.** `GoogleEvent` gains `creator?: { email?: string }`;
  the adapter puts it on the `SourceRecord` as `creatorEmail`;
  `src/worker/sync.ts` passes it to `ownersFor`. `creatorEmail` is not
  stored on the event and doesn't change the source hash unless the
  owners change.
- **Google changes to hub events** (`mutations.ts`, household two-way):
  unchanged; a renamed hub event keeps `titleFromGoogle` then
  `ownersFor` without a creator.
- **Calendar form.** The calendar page and `/api/v1/people` say which
  person is "me" (by the signed-in user's email); `event-form.tsx` and
  the iPhone `EventEditor.swift` tick that person for a new event.
- **Cookie.** `whoIsIt` with no names returns the asker's person when
  there is one (`ctx.userId` → user email → person); the read-back
  names them. SHA-3's "material names someone else" still wins.
- **Email suggestions.** With no person in the suggestion, the event's
  owners are the person whose email is the connected Gmail account's.

## 4. Testing
- Unit: `ownersFor` order (name, family/everyone, creator, defaults,
  primary); email matching ignores case; no creator → today's result.
- Unit: `whoIsIt` with no names gives the asker; unknown asker asks.
- Integration (`verify:full`): a household sync with a creator-made
  "Dentist" gives the creator; with an owners override it doesn't
  change; People email save refuses a duplicate.
- E2E: on the calendar form, a signed-in parent with an email in People
  sees themself ticked.
- iOS: `CalendarTests` for the editor's default owner.

## 5. Concerns for the owner
| # | Concern | Recommendation |
|---|---|---|
| C-1 | A parent adds "Dentist" meaning a child's, with no name: it becomes the parent's, and won't clash with the child's events. | Accept; write the child's name, or change whose it is on the event. |
| C-2 | The first sync after this moves many household events from everyone to their creator at once. | Accept (OWN-7); it's what was asked. Overrides are kept. |
| C-3 | Events made by people outside the family (a shared invite) match no one and keep today's default. | Accept (OWN-3). |
