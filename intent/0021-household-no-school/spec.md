# Spec: School stays out of the household calendar
Status: approved (owner, 2026-10-18, in chat: "approve intent 0021 with the defaults (closures stay out too)"); N-1 accepted. Written by Claude from [intent.md](intent.md).

Read with [0020's spec](../0020-household-two-way/spec.md). IDs here: NOS
(no school).

## 1. What changes in earlier specs
- **0020 TWO-1** "Every hub event, once" now excepts school (NOS-1).
- **0020 TWO-5** (school days as one block per child) is replaced by
  NOS-1: school isn't written at all.
- **0020 BACK-2** reading Google edits back skips school events, as it
  did school blocks.
- Everything else in 0020 stays as it is.

## 2. Requirements

### 2.1 No school (NOS)
| ID | Requirement | Acceptance criteria |
|---|---|---|
| NOS-1 | School isn't written. | Events in the categories `school_class` and `school_closure`, for any child, are never created or changed in Household by the sync. They stay in the hub as today. |
| NOS-2 | What was written goes. | A school block or closure the sync wrote earlier (tagged `hubEventId`, in `household_links`) that hasn't ended is deleted from Household on the next run, and its link removed. Ended ones are left alone (TWO-7). If that is more than 10 deletes, the run is held as any other (TWSEC-2). |
| NOS-3 | Edits in Google ignored. | A school event's Google copy that is moved or deleted in Google before NOS-2 removes it changes nothing in the hub. |

## 3. Design
`planHousehold` (`src/domain/household-sync.ts`) leaves `LEFT_OUT`
categories out of the wanted set; the existing "linked but not wanted"
step then deletes what it wrote before, past ones excepted. `readBack`
skips items in those categories. No schema, job or app change.

## 4. Testing
Unit: a school day, a past school day and a closure with existing links
give no creates or updates and remove only the current block and the
closure.

## 5. Concerns for the owner
| # | Concern | Recommendation |
|---|---|---|
| N-1 | If the sync has already been On, the first run deletes many school events and is held. | Approve it with "Apply anyway"; it is only school. If the switch is still Off or Dry run, nothing was written and nothing happens. |
