# Spec: A push for each step of his tennis and swimming, every suggestion and every clash
Status: draft (2026-10-19). Written by Claude from [intent.md](intent.md).

Read with 0001 (TEN-9..11, SWM-2, SWM-3, SYNC-5), 0004 (PUSH-1..6),
0009 (ERA-3, the `OPT_IN_KINDS` rule) and 0017 (ACC-6).
IDs here: NTF (notifications).

## 1. What changes in earlier specs
- **0004 PUSH-1** Adds kinds `tennis_result` and `swim`; `entry_change`
  also fires when he's entered; `clash` also fires once as a reminder.
- **0004 PUSH-3** New kinds on by default; `suggestion` switched on once by
  the new app build for phones that never set it.
- **0004 PUSH-4** A clash push opens the clash screen, not one event.
- **0004 PUSH-6** Stays; the key goes into production (owner, O-2, O-3).

## 2. Requirements

### 2.1 Sending (NTF)
| ID | Requirement | Acceptance criteria |
|---|---|---|
| NTF-1 | Pushes reach the phone. | With the APNs key's secret version and the key and team IDs applied, a test notification (worker job `push:test`, the owner's phones only) shows on the owner's iPhone with its real text; the worker logs `notified … sent: 1`, not "no APNs key". |

### 2.2 Tennis (NTF-T)
| ID | Requirement | Acceptance criteria |
|---|---|---|
| NTF-T1 | Open to enter. | Stays as TEN-9: an entry going to `found` (including from `not_open`) pushes "Tournament to enter: <tournament> (<event>), enter by <deadline>". Label becomes "Tournament open to enter, or to pay". |
| NTF-T2 | Registered. | An entry moving to `entered` (from found, not open, skipped or payment needed) pushes "Registered: <tournament> (<event>)", once per entry, kind `entry_change`. Opens the entry page (`tennis/entries/<id>`). |
| NTF-T3 | Accepted. | Stays as ACC-6. Target becomes the entry page. |
| NTF-T4 | Draw out. | Stays as TEN-11 (the first opponent = the draw is out). |
| NTF-T5 | Result posted. | When one of his matches gets a winner, push once per match, kind `tennis_result`: title the tournament, body "Won 6-3 6-4 against <name> (<round>)" or "Lost …"; a walkover or retirement says so. Opens the tournament. A score corrected later doesn't push again. Matches dated more than 7 days ago (a first sync of old history) don't push. |

### 2.3 Swimming (NTF-S)
| ID | Requirement | Acceptance criteria |
|---|---|---|
| NTF-S1 | Entered in a meet. | The first time a meet has active entries for him, push once, kind `swim`: "Entered: <meet>", body his events with seed times ("50 FR 34.12, 100 BK NT"). An event added later pushes "Added to <meet>: 200 IM". Opens the meet. |
| NTF-S2 | Heat sheet out. | If SP-S1 finds heats and lanes before the meet: the first time all his entries for a meet day have a heat and lane, push once: "Heat sheet: <meet>, day N", body "50 FR heat 3 lane 4, …". If SP-S1 finds nothing, NTF-S2 is dropped and the plan says so. |
| NTF-S3 | Results posted. | New results for a meet day push once per batch, kind `swim`: "Results: <meet>", body each new swim's time and place, "best time" when it's his best in that event and course, "DQ" with the reason. A later batch the same day lists only the new swims. Results older than 7 days don't push. Opens the meet. |

### 2.4 Suggestions and clashes (NTF-C)
| ID | Requirement | Acceptance criteria |
|---|---|---|
| NTF-C1 | Every suggestion. | Every source that makes suggestions pushes, kind `suggestion` (email today; Classroom, 0015, when it lands). The new app build turns `suggestion` on once, on its first launch, unless this phone switched it off itself before. |
| NTF-C2 | Clash opens the clash. | A clash push opens the clash screen: both events (title, person, time, place), the overlap, and Accept clash, Skip this occurrence (each side), Open event (each side). After an action the screen says what happened; a clash already resolved says "Already resolved". |
| NTF-C3 | Reminder. | A clash still open (not accepted, neither side skipped or deleted) 2 days before its first event starts pushes once more: "Still a clash on <day>". |

### 2.5 Compatibility and security (NTF-SEC)
| ID | Requirement | Acceptance criteria |
|---|---|---|
| NTF-SEC1 | Old builds keep working. | `GET /api/v1/devices/current` keeps `available` with the old kinds only; new kinds come in a new field `more` that old builds ignore. A phone on an old build never gets `tennis_result` or `swim` (they aren't in its kinds). |
| NTF-SEC2 | Nothing personal through Apple. | PUSH-2 unchanged: payloads carry the id and kind only; the text is fetched by the extension. |

## 3. Design
- **Kinds.** `NOTIFICATION_KINDS` gains `tennis_result` and `swim`, both
  in `OPT_IN_KINDS` (listed in `more`, not `available`). The kind check
  constraint changes: one migration (`pnpm db:generate --name
  notification_kinds_0023`).
- **Tennis.** `notifyEntryChange` adds the `entered` case. New
  `notifyTennisResults(db)` after the tennis sync and the draw watch: his
  matches with `winner` set and `match_date` ≥ today − 7, dedup
  `tennis_result:<match id>`.
- **Swimming.** After a Commit Swimming sync, `notifySwim(db, sourceId)`:
  entries per meet (dedup `swim_entered:<meet>`, then
  `swim_entry:<meet>:<event>` for later additions), heat sheet per meet
  day if SP-S1 (dedup `swim_heats:<meet>:<day>`), results per meet day
  (dedup `swim_results:<meet>:<day>:<result ids hash>`; the body lists
  only swims not in an earlier push).
- **Backfill (N-3).** On the first run after deploy, dedup rows for
  entries and results already known are written without sending.
- **Clash.** The push keeps `target: events/<first>` (old builds open the
  event, as today); the new build sees kind `clash` and opens the clash
  screen for that pair. `notifyClashes` also sends the reminder (dedup
  `clash_reminder:<a>|<b>`) when the first event starts within 48 h.
- **iPhone.** Settings → Notifications lists `more` as switches;
  one-time switch-on of `suggestion`, `tennis_result` and `swim` (a
  UserDefaults flag so it runs once); the clash screen; targets for
  `tennis/entries/<id>` and `swimming/meets/<id>` (the routes exist).
  Build bump and TestFlight after.
- **`push:test` job.** One test notification to the owner's phones only
  (`userId`), kind `sync_failed`, dedup by minute; for NTF-1 and the APNs
  runbook.

## 4. Testing
- Unit: text builders (scores, walkover, best time, DQ, seed time "NT").
- Integration (fake APNs, test DB): each NTF-T/S/C push fires once, with
  the right target; a second sync sends nothing; old results (> 7 days)
  and the backfill send nothing; `more` vs `available`; a phone with only
  old kinds gets no new ones.
- iOS: HubKit decode of `more`; the one-time switch-on runs once;
  simulator screenshot of the clash screen opened from a clash push.
- Production: the NTF-1 test push on the owner's phone; then the first
  real tennis or swim push (reported as waiting on the owner until one
  comes up).

## 5. Concerns for the owner
| # | Concern | Recommendation |
|---|---|---|
| N-1 | Without the APNs key nothing in this intent (or 0004) arrives. | Do O-2 and O-3 first; P1 can ship meanwhile, but nothing is checkable on the phone until then. |
| N-2 | More pushes: on a tournament weekend, 2–4 results a day plus draws. | Fine for one child; each kind can be switched off in Settings → Notifications. |
| N-3 | The first sync after deploy could see entries and results already known as "new". | The 7-day limit plus the backfill (§3). |
