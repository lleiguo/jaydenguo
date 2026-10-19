import Foundation
import Testing
@testable import HubKit

/// An event as the API sends it, with only the fields a test cares about.
func event(
    _ id: String,
    _ start: String,
    _ end: String,
    title: String? = nil,
    category: String = "soccer",
    allDay: Bool = false,
    owners: [String] = ["p1"],
    source: String? = nil,
    status: String = "active"
) -> CalendarEvent {
    let json: [String: Any] = [
        "id": id, "title": title ?? id, "category": category, "attendance": "required", "owners": owners,
        "start": start, "end": end, "allDay": allDay, "status": status, "schoolClosed": false,
        "source": (source.map { ["id": $0, "name": $0, "kind": "ical"] } as Any?) ?? NSNull(),
    ]
    let data = try! JSONSerialization.data(withJSONObject: json)
    return try! JSONDecoder().decode(CalendarEvent.self, from: data)
}

func payload(_ events: [CalendarEvent], clashes: [(String, String, String?)] = []) -> CalendarPayload {
    let json: [String: Any] = [
        "events": [],
        "clashes": clashes.map { ["a": $0.0, "b": $0.1, "overlapMin": 30, "people": ["p1"], "acceptedId": ($0.2 as Any?) ?? NSNull()] },
        "closures": [], "homeTimeZone": "America/Toronto", "cursor": 1,
        "people": [["id": "p1", "name": "Child", "isPrimary": true], ["id": "p2", "name": "Parent", "isPrimary": false]],
    ]
    var p = try! JSONDecoder().decode(CalendarPayload.self, from: JSONSerialization.data(withJSONObject: json))
    p.events = events
    return p
}

@Suite struct CalendarDatesTests {
    @Test func weeksStartOnMonday() {
        #expect(CalendarDates.weekStart("2026-09-29") == "2026-09-28")
        #expect(CalendarDates.weekStart("2026-10-04") == "2026-09-28")
        #expect(CalendarDates.weekday("2026-09-27") == 0)
    }

    @Test func monthGridCoversTheMonth() {
        let grid = CalendarDates.monthGrid("2026-02-14")
        #expect(grid.first?.first == "2026-01-26")
        #expect(grid.allSatisfy { $0.count == 7 })
        #expect(grid.flatMap { $0 }.contains("2026-02-28"))
        #expect(!grid.flatMap { $0 }.contains("2026-03-02"))
    }
}

@Suite struct CalendarIndexTests {
    let game = event("game", "2026-10-03T14:00:00.000Z", "2026-10-03T15:00:00.000Z")
    let lesson = event("lesson", "2026-10-03T14:30:00.000Z", "2026-10-03T15:30:00.000Z", category: "tennis", owners: ["p2"])

    @Test func filtersByPersonCategoryAndSource() {
        var f = CalendarFilters()
        #expect(f.isVisible(lesson))
        f.hiddenPeople = ["p2"]
        #expect(!f.isVisible(lesson))
        #expect(f.isVisible(event("closed", "2026-10-05T00:00:00.000Z", "2026-10-06T00:00:00.000Z", category: "school_closure", allDay: true, owners: ["p2"])))
        f = CalendarFilters()
        f.hiddenCategories = ["tennis"]
        #expect(!f.isVisible(lesson))
        f = CalendarFilters()
        f.hiddenSources = ["feed"]
        #expect(!f.isVisible(event("x", "2026-10-03T14:00:00.000Z", "2026-10-03T15:00:00.000Z", source: "feed")))
    }

    @Test func marksClashesWithHiddenEvents() {
        let index = CalendarIndex(payload([game, lesson], clashes: [("game", "lesson", nil)]))
        var f = CalendarFilters()
        #expect(index.mark(for: ["game"], filters: f) == .clash)
        f.hiddenPeople = ["p2"]
        #expect(index.mark(for: ["game"], filters: f) == .withHiddenEvent)
        #expect(index.clashes(of: "game").first?.other?.id == "lesson")
    }

    @Test func acceptedClashesDontMark() {
        let index = CalendarIndex(payload([game, lesson], clashes: [("game", "lesson", "acc")]))
        #expect(index.mark(for: ["game", "lesson"], filters: CalendarFilters()) == .none)
    }

    @Test func leavesOutCancelledEventsAddedHere() {
        let mine = event("mine", "2026-10-03T14:00:00.000Z", "2026-10-03T15:00:00.000Z", status: "cancelled")
        let synced = event("synced", "2026-10-03T14:00:00.000Z", "2026-10-03T15:00:00.000Z", source: "feed", status: "cancelled")
        #expect(CalendarIndex(payload([mine, synced])).shown(CalendarFilters()).map(\.id) == ["synced"])
    }

    @Test func namesOwnersOnlyWhenNotJustThePrimaryPerson() {
        let index = CalendarIndex(payload([game, lesson]))
        #expect(index.ownerNames(game) == nil)
        #expect(index.ownerNames(lesson) == "Parent")
    }
}

@Suite struct DayLayoutTests {
    let toronto = HomeTime(identifier: "America/Toronto", locale: Locale(identifier: "en_CA"))

    @Test func putsEventsOnTheirHomeDate() {
        // 23:30 in Toronto on the 3rd is the 4th in UTC.
        let late = event("late", "2026-10-04T03:30:00.000Z", "2026-10-04T04:00:00.000Z")
        let trip = event("trip", "2026-10-03T00:00:00.000Z", "2026-10-05T00:00:00.000Z", allDay: true)
        let day3 = DayLayout.events(on: "2026-10-03", from: [late, trip], homeTime: toronto)
        #expect(day3.timed.map(\.id) == ["late"])
        #expect(day3.allDay.map(\.id) == ["trip"])
        let day4 = DayLayout.events(on: "2026-10-04", from: [late, trip], homeTime: toronto)
        #expect(day4.timed.isEmpty)
        #expect(day4.allDay.map(\.id) == ["trip"])
        #expect(DayLayout.events(on: "2026-10-05", from: [trip], homeTime: toronto).allDay.isEmpty)
    }

    @Test func overlappingEventsShareTheWidth() {
        let a = event("a", "2026-10-03T14:00:00.000Z", "2026-10-03T15:00:00.000Z")
        let b = event("b", "2026-10-03T14:30:00.000Z", "2026-10-03T15:30:00.000Z")
        let c = event("c", "2026-10-03T16:00:00.000Z", "2026-10-03T17:00:00.000Z")
        let placed = DayLayout.place([a, b, c], on: "2026-10-03", homeTime: toronto, start: \.startDate, end: \.endDate)
        let byId = Dictionary(uniqueKeysWithValues: placed.map { ($0.item.id, $0) })
        #expect(byId["a"]?.columns == 2 && byId["b"]?.columns == 2)
        #expect(byId["a"]?.column != byId["b"]?.column)
        #expect(byId["c"]?.columns == 1)
        #expect(byId["a"]?.startMinute == 600) // 10:00 EDT
    }
}

@Suite struct EventMoveTests {
    let toronto = HomeTime(identifier: "America/Toronto", locale: Locale(identifier: "en_CA"))

    @Test func snapsToFifteenMinutes() {
        #expect(EventMove.snap(607) == 600)
        #expect(EventMove.snap(608) == 615)
    }

    @Test func keepsTheLength() throws {
        let e = event("e", "2026-10-03T14:00:00.000Z", "2026-10-03T15:30:00.000Z")
        let moved = try #require(EventMove.timed(e, to: "2026-10-04", minute: 18 * 60 + 5, homeTime: toronto))
        #expect(moved.start == HomeTime.parse("2026-10-04T22:00:00.000Z"))
        #expect(moved.end.timeIntervalSince(moved.start) == 90 * 60)
    }

    @Test func movesAllDayEventsByDate() throws {
        let e = event("e", "2026-10-03T00:00:00.000Z", "2026-10-05T00:00:00.000Z", allDay: true)
        let moved = try #require(EventMove.allDay(e, to: "2026-10-10"))
        #expect(moved.start == HomeTime.parse("2026-10-10T00:00:00.000Z"))
        #expect(moved.end == HomeTime.parse("2026-10-12T00:00:00.000Z"))
    }
}

@Suite struct SchoolBlockTests {
    @Test func foldsTwoOrMoreClassesADay() {
        let toronto = HomeTime(identifier: "America/Toronto")
        let classes = [
            event("m", "2026-10-05T12:30:00.000Z", "2026-10-05T13:15:00.000Z", category: "school_class"),
            event("s", "2026-10-05T13:30:00.000Z", "2026-10-05T14:15:00.000Z", category: "school_class"),
            event("lone", "2026-10-06T12:30:00.000Z", "2026-10-06T13:15:00.000Z", category: "school_class"),
        ]
        let blocks = SchoolBlock.blocks(classes, homeTime: toronto)
        #expect(blocks.count == 1)
        #expect(blocks[0].date == "2026-10-05")
        #expect(blocks[0].end == "2026-10-05T14:15:00.000Z")
    }

    @Test func keepsEachChildsClassesInHisOwnBlock() {
        let toronto = HomeTime(identifier: "America/Toronto")
        let cls = { (id: String, from: String, to: String, owner: String) in
            event(id, "2026-10-05T\(from):00.000Z", "2026-10-05T\(to):00.000Z", category: "school_class", owners: [owner])
        }
        let blocks = SchoolBlock.blocks([
            cls("e1", "12:00", "13:00", "p2"), cls("j1", "12:30", "13:15", "p1"),
            cls("e2", "18:30", "19:30", "p2"), cls("j2", "18:00", "19:00", "p1"),
        ], homeTime: toronto)
        #expect(blocks.map(\.id) == ["school:2026-10-05:p2", "school:2026-10-05:p1"])
        #expect(blocks.map { $0.classes.map(\.id) } == [["e1", "e2"], ["j1", "j2"]])
    }
}

/// Intent 0022, DEL-2, DEL-4: the same words as the website's confirm.
@Suite struct DeleteConfirmTests {
    @Test func asksPlainlyForAnEventAddedHere() {
        let c = event("e1", "2026-10-05T14:00:00Z", "2026-10-05T15:00:00Z", title: "Dentist").deleteConfirm(householdOn: false)
        #expect(c.title == "Delete “Dentist”?")
        #expect(c.message == nil)
    }

    @Test func saysASourceEventStaysDeleted() {
        let c = event("e1", "2026-10-05T14:00:00Z", "2026-10-05T15:00:00Z", title: "Soccer", source: "Spordle").deleteConfirm(householdOn: false)
        #expect(c.message == "It stays deleted when Spordle syncs. Restore it from Settings → Deleted.")
        let tennis = DeleteConfirm.text(title: "Open", sourceName: "Tennis", sourceKind: "tennis_tc", householdOn: false)
        #expect(tennis.message?.contains("This doesn't withdraw the entry.") == true)
    }

    @Test func saysWhereAHouseholdEventGoes() {
        let on = DeleteConfirm.text(title: "Dinner", sourceName: "Household", sourceKind: "google_calendar", householdOn: true)
        let off = DeleteConfirm.text(title: "Dinner", sourceName: "Household", sourceKind: "google_calendar", householdOn: false)
        #expect(on.message == "It goes from the family's Google Calendar too.")
        #expect(off.message?.hasPrefix("It stays in the family's Google Calendar.") == true)
    }
}
