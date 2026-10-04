# Spec: Past suggestions clear, skipped events hide
Status: draft (2026-10-03). Written by Claude from [intent.md](intent.md).

Read with 0001 (EML-2, EML-3, CAL-3, CON-4), 0004 (ICAL-1, ICAL-5,
IEML-1) and 0008 (EMS-2). IDs here: TID (tidier lists).

## 1. What changes in earlier specs
- **0001 EML-3, 0004 IEML-1, 0008 EMS-2** Past suggestions leave the
  waiting list, the pending counts and Cookie's suggestion tools (TID-1).
- **0001 CAL-3, 0004 ICAL-1** Skipped events are hidden until shown
  (TID-3).
- **0001 CON-4, 0004 ICAL-5** Skip and un-skip work as they do.

## 2. Requirements

### 2.1 Suggestions (TID)
| ID | Requirement | Acceptance criteria |
|---|---|---|
| TID-1 | A pending suggestion about a past day is cleared. | Its day: `extracted.date`, else the home-zone date of the event it targets. Past = before today in the home time zone. Cleared suggestions aren't in `GET /api/v1/suggestions`, aren't in `pending` or Today's count, and Cookie's suggestion tools don't see them. A suggestion with no day stays pending. |
| TID-2 | Cleared suggestions show as "Past". | `?status=decided` includes them with `status: "expired"`, newest email first. The web and iPhone lists show "Past" and no actions. Approving or rejecting one answers 409 "This is already over." |

### 2.2 Calendar (TID)
| ID | Requirement | Acceptance criteria |
|---|---|---|
| TID-3 | Skipped events are hidden by default. | Events with `override.skip` don't appear in agenda, day, week or month, on the web or iPhone, until shown. |
| TID-4 | A toggle shows them. | Web: a "Skipped" chip beside Filters (`aria-pressed`). iPhone: "Show skipped" in the calendar menu. Shown, they look as today and can be un-skipped. The choice persists per device; older saved filters still load. |

## 3. Design
- `src/server/email/suggestions.ts`: `isPast(s, targetStart, today, tz)`;
  `listSuggestions("pending")` and `pendingCount` drop past ones;
  `"decided"` adds them as `expired`. `pending()` refuses past ones.
- Web: `Filters.showSkipped` (default false) in `filters.ts`; the
  calendar drops skipped events from what it shows unless on.
- iPhone: `CalendarStore.showSkipped`, saved in `UserDefaults`, applied in
  `shown`. The `CalendarFilters` format doesn't change, so the widgets
  and saved filters are untouched.

## 4. Testing
- Unit: the past rule (date, target, neither, today, time zone edge).
- Integration: list, count, decided and approve/reject on a past one.
- e2e (web): a skipped event is hidden, the chip shows it.
- iOS: HubKit/app build; screenshot of the menu toggle in the simulator.

## 5. Concerns for the owner
| # | Concern | Recommendation |
|---|---|---|
| T-1 | A suggestion with a wrong date read by AI could clear early. | Accept: it's still under "Recently decided", with the email link. |
