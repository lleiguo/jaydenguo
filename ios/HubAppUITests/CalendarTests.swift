import XCTest

/// N3 (intent 0004, ICAL-1..7, APP-2, CON-3) against the local seed server.
/// Every test leaves the data as it found it (undo, or delete what it added).
final class CalendarTests: XCTestCase {
    private var server: String { ProcessInfo.processInfo.environment["HUB_TEST_SERVER"] ?? "http://localhost:3200" }

    /// An event a test added, deleted afterwards even if the test fails.
    private var cleanup: (title: String, token: String)?

    override func setUp() {
        continueAfterFailure = false
    }

    override func tearDown() {
        if let cleanup { deleteEvents(titled: cleanup.title, token: cleanup.token) }
        cleanup = nil
        super.tearDown()
    }

    private func devToken() throws -> String {
        let url = try XCTUnwrap(URL(string: "\(server)/auth/dev?client=ios"))
        let done = expectation(description: "token")
        var token: String?
        URLSession.shared.dataTask(with: url) { data, _, _ in
            token = data.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] }?["token"] as? String
            done.fulfill()
        }.resume()
        wait(for: [done], timeout: 30)
        return try XCTUnwrap(token, "is the development server running at \(server)?")
    }

    /// Deletes (softly, through the API) any event whose title starts with
    /// this one in the next month, so a failed test leaves nothing behind.
    private func deleteEvents(titled title: String, token: String) {
        let from = ISO8601DateFormatter().string(from: .now.addingTimeInterval(-86_400 * 2))
        let to = ISO8601DateFormatter().string(from: .now.addingTimeInterval(86_400 * 30))
        var list = URLRequest(url: URL(string: "\(server)/api/v1/events?from=\(from)&to=\(to)")!)
        list.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        let done = expectation(description: "cleanup")
        URLSession.shared.dataTask(with: list) { data, _, _ in
            let events = (data.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] }?["events"] as? [[String: Any]]) ?? []
            let group = DispatchGroup()
            for e in events where (e["title"] as? String)?.hasPrefix(title) == true && e["deletedAt"] is NSNull {
                var delete = URLRequest(url: URL(string: "\(self.server)/api/v1/events/\(e["id"] as! String)")!)
                delete.httpMethod = "DELETE"
                delete.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
                group.enter()
                URLSession.shared.dataTask(with: delete) { _, _, _ in group.leave() }.resume()
            }
            group.notify(queue: .main) { done.fulfill() }
        }.resume()
        wait(for: [done], timeout: 30)
    }

    private func launch(_ extra: [String] = []) throws -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["-HubBaseURL", server, "-HubUITestToken", try devToken(), "-HubNoLock"] + extra
        app.launch()
        XCTAssertTrue(app.navigationBars["Today"].waitForExistence(timeout: 20))
        return app
    }

    private func openCalendar(_ app: XCUIApplication) {
        app.tabBars.buttons["Calendar"].tap()
        XCTAssertTrue(app.navigationBars["Calendar"].waitForExistence(timeout: 10))
    }

    /// The seed's weekly Sunday hockey game (09:00 in the home zone).
    private func thisSunday() -> String {
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = TimeZone(identifier: "America/Toronto")!
        let today = cal.startOfDay(for: .now)
        let weekday = cal.component(.weekday, from: today) // 1 = Sunday
        let sunday = cal.date(byAdding: .day, value: weekday == 1 ? 0 : 8 - weekday, to: today)!
        let c = cal.dateComponents([.year, .month, .day], from: sunday)
        return String(format: "%04d-%02d-%02d", c.year!, c.month!, c.day!)
    }

    /// Scrolls a sheet until the button can be tapped.
    private func reveal(_ button: XCUIElement, in app: XCUIApplication) {
        for _ in 0..<4 where !(button.exists && button.isHittable) { app.swipeUp() }
    }

    func testTodayShowsTheCards() throws {
        let app = try launch()
        let list = app.collectionViews["todayList"]
        XCTAssertTrue(list.waitForExistence(timeout: 20))
        XCTAssertTrue(app.staticTexts["Clashes in the next 7 days"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.tabBars.buttons["Calendar"].exists)
    }

    func testAgendaMarksClashes() throws {
        let app = try launch()
        openCalendar(app)
        XCTAssertTrue(app.collectionViews["agenda"].waitForExistence(timeout: 20))
        let clash = app.images.matching(NSPredicate(format: "label == 'Clash'")).firstMatch
        for _ in 0..<6 where !clash.exists { app.collectionViews["agenda"].swipeUp() }
        XCTAssertTrue(clash.exists, "a seeded clash is marked in the agenda")
    }

    /// SCH-1: a school day opens to show its classes, and folds away again.
    func testSchoolBlockOpensAndFolds() throws {
        let app = try launch()
        openCalendar(app)
        let agenda = app.collectionViews["agenda"]
        XCTAssertTrue(agenda.waitForExistence(timeout: 20))
        let block = agenda.buttons.matching(identifier: "school-block").firstMatch
        for _ in 0..<6 where !(block.exists && block.isHittable) { agenda.swipeUp() }
        XCTAssertTrue(block.exists, "the seed has a school day in the agenda")
        block.tap()
        let open = agenda.buttons.matching(identifier: "school-block-open")
        XCTAssertTrue(open.firstMatch.waitForExistence(timeout: 5), "the open school day can be folded")
        XCTAssertEqual(open.count, 1)
        open.firstMatch.tap()
        XCTAssertTrue(open.firstMatch.waitForNonExistence(timeout: 5), "tapping it folds the classes away")
    }

    func testDragToMoveThenUndo() throws {
        let app = try launch()
        app.open(URL(string: "jaydenguohub://open/calendar?date=\(thisSunday())")!)
        let game = app.descendants(matching: .any).matching(NSPredicate(format: "label BEGINSWITH 'Hockey game'")).firstMatch
        XCTAssertTrue(game.waitForExistence(timeout: 20))
        let original = game.label
        let start = game.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.3))
        start.press(forDuration: 0.8, thenDragTo: start.withOffset(CGVector(dx: 0, dy: 112)))
        XCTAssertTrue(app.staticTexts["Moved."].waitForExistence(timeout: 10))
        let moved = app.descendants(matching: .any).matching(NSPredicate(format: "label BEGINSWITH 'Hockey game'")).firstMatch
        XCTAssertNotEqual(moved.label, original, "the game shows its new time")

        app.buttons["undo"].tap()
        XCTAssertTrue(app.staticTexts["Undone."].waitForExistence(timeout: 10))
        let back = app.descendants(matching: .any).matching(NSPredicate(format: "label == %@", original)).firstMatch
        XCTAssertTrue(back.waitForExistence(timeout: 10), "undo puts it back")
    }

    func testSkipFromTheSheetThenUndo() throws {
        let app = try launch()
        openCalendar(app)
        let agenda = app.collectionViews["agenda"]
        XCTAssertTrue(agenda.waitForExistence(timeout: 20))
        let row = agenda.buttons.matching(NSPredicate(format: "label CONTAINS 'Soccer practice'")).firstMatch
        for _ in 0..<6 where !row.exists { agenda.swipeUp() }
        row.tap()
        let skip = app.buttons["Skip this one"]
        _ = skip.waitForExistence(timeout: 10)
        reveal(skip, in: app)
        skip.tap()
        XCTAssertTrue(app.staticTexts["Skipped."].waitForExistence(timeout: 10))
        app.buttons["undo"].tap()
        XCTAssertTrue(app.staticTexts["Undone."].waitForExistence(timeout: 10))
    }

    func testSkipEveryRepeatThenUndo() throws {
        let app = try launch()
        openCalendar(app)
        let agenda = app.collectionViews["agenda"]
        XCTAssertTrue(agenda.waitForExistence(timeout: 20))
        XCTAssertTrue(app.buttons["agenda-show-earlier"].exists, "past events are hidden behind Show earlier")
        let row = agenda.buttons.matching(NSPredicate(format: "label CONTAINS 'Math tutoring'")).firstMatch
        for _ in 0..<10 where !row.exists { agenda.swipeUp() }
        row.tap()
        let skip = app.buttons["Skip every repeat"]
        _ = skip.waitForExistence(timeout: 10)
        reveal(skip, in: app)
        skip.tap()
        XCTAssertTrue(app.staticTexts["Skipped every repeat."].waitForExistence(timeout: 10))
        app.buttons["undo"].tap()
        XCTAssertTrue(app.staticTexts["Undone."].waitForExistence(timeout: 10))
    }

    func testAddAnEventThenDeleteIt() throws {
        let app = try launch()
        openCalendar(app)
        app.buttons["Add event"].tap()
        let title = "UI test event \(Int.random(in: 1000...9999))"
        cleanup = (title, try devToken())
        let field = app.textFields["Title"]
        XCTAssertTrue(field.waitForExistence(timeout: 10))
        field.tap()
        field.typeText(title)
        app.buttons["Save"].tap()
        XCTAssertTrue(app.staticTexts["Added."].waitForExistence(timeout: 10))

        let agenda = app.collectionViews["agenda"]
        let row = agenda.buttons.matching(NSPredicate(format: "label CONTAINS %@", title)).firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: 15))
        row.tap()
        let delete = app.buttons["Delete"]
        _ = delete.waitForExistence(timeout: 10)
        reveal(delete, in: app)
        delete.tap()
        app.sheets.buttons["Delete"].firstMatch.tap()
        XCTAssertTrue(app.staticTexts["Deleted."].waitForExistence(timeout: 10))
        XCTAssertTrue(row.waitForNonExistence(timeout: 10))
    }

    /// Intent 0022, DEL-1, DEL-2: a feed's event can be deleted too, after
    /// a confirm that says it stays deleted; undo brings it back.
    func testDeleteAFeedEventThenUndo() throws {
        let app = try launch()
        openCalendar(app)
        let agenda = app.collectionViews["agenda"]
        XCTAssertTrue(agenda.waitForExistence(timeout: 20))
        let row = agenda.buttons.matching(NSPredicate(format: "label CONTAINS 'Hockey ice time'")).firstMatch
        for _ in 0..<10 where !row.exists { agenda.swipeUp() }
        row.tap()
        let delete = app.buttons["Delete"]
        _ = delete.waitForExistence(timeout: 10)
        reveal(delete, in: app)
        delete.tap()
        let message = app.staticTexts["It stays deleted when Hockey team (sample) syncs. Restore it from Settings → Deleted."]
        XCTAssertTrue(message.waitForExistence(timeout: 10))
        app.sheets.buttons["Delete"].firstMatch.tap()
        XCTAssertTrue(app.staticTexts["Deleted."].waitForExistence(timeout: 10))
        app.buttons["undo"].tap()
        XCTAssertTrue(app.staticTexts["Undone."].waitForExistence(timeout: 10))
    }

    /// Edit on the event's sheet opens the editor, and Save saves.
    func testEditAnEventFromItsSheet() throws {
        let app = try launch()
        openCalendar(app)
        app.buttons["Add event"].tap()
        let title = "UI test edit \(Int.random(in: 1000...9999))"
        cleanup = (title, try devToken())
        let field = app.textFields["Title"]
        XCTAssertTrue(field.waitForExistence(timeout: 10))
        field.tap()
        field.typeText(title)
        app.buttons["Save"].tap()
        XCTAssertTrue(app.staticTexts["Added."].waitForExistence(timeout: 10))

        let agenda = app.collectionViews["agenda"]
        let row = agenda.buttons.matching(NSPredicate(format: "label CONTAINS %@", title)).firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: 15))
        row.tap()
        let edit = app.buttons["Edit"]
        _ = edit.waitForExistence(timeout: 10)
        reveal(edit, in: app)
        edit.tap()
        let editField = app.textFields["Title"]
        XCTAssertTrue(editField.waitForExistence(timeout: 10), "the editor opens")
        editField.tap()
        editField.typeText(" edited")
        app.buttons["Save"].tap()
        XCTAssertTrue(app.staticTexts["Saved."].waitForExistence(timeout: 10))
        let edited = agenda.buttons.matching(NSPredicate(format: "label CONTAINS %@", "\(title) edited")).firstMatch
        XCTAssertTrue(edited.waitForExistence(timeout: 15))
    }

    /// "Move to…" on the sheet, the way to move without dragging (NFR-9).
    func testMoveToFromTheSheetThenUndo() throws {
        let app = try launch()
        app.open(URL(string: "jaydenguohub://open/calendar?date=\(thisSunday())")!)
        let game = app.descendants(matching: .any).matching(NSPredicate(format: "label BEGINSWITH 'Hockey game'")).firstMatch
        XCTAssertTrue(game.waitForExistence(timeout: 20))
        let original = game.label
        game.tap()
        let moveTo = app.buttons["Move to…"]
        XCTAssertTrue(moveTo.waitForExistence(timeout: 10))
        moveTo.tap()
        let move = app.buttons["Move"]
        XCTAssertTrue(move.waitForExistence(timeout: 10))
        move.tap()
        XCTAssertTrue(app.staticTexts["Moved."].waitForExistence(timeout: 10))
        app.buttons["undo"].tap()
        XCTAssertTrue(app.staticTexts["Undone."].waitForExistence(timeout: 10))
    }

    /// From the agenda: the row opens its own event, and "Move to…" moves it.
    func testMoveToFromTheAgendaThenUndo() throws {
        let app = try launch()
        openCalendar(app)
        let agenda = app.collectionViews["agenda"]
        XCTAssertTrue(agenda.waitForExistence(timeout: 20))
        let row = agenda.buttons.matching(NSPredicate(format: "label CONTAINS 'Soccer practice'")).firstMatch
        for _ in 0..<6 where !row.isHittable { agenda.swipeUp() }
        row.tap()
        XCTAssertTrue(app.navigationBars["Soccer practice"].waitForExistence(timeout: 10), "the sheet is for the tapped row")
        let moveTo = app.buttons["Move to…"]
        XCTAssertTrue(moveTo.waitForExistence(timeout: 10))
        moveTo.tap()
        let move = app.buttons["Move"]
        XCTAssertTrue(move.waitForExistence(timeout: 10))
        move.tap()
        XCTAssertTrue(app.staticTexts["Moved."].waitForExistence(timeout: 10))
        // Both sheets close, so the undo banner can be tapped.
        XCTAssertTrue(app.navigationBars["Soccer practice"].waitForNonExistence(timeout: 5))
        app.buttons["undo"].tap()
        XCTAssertTrue(app.staticTexts["Undone."].waitForExistence(timeout: 10))
    }

    func testPeopleChipsAreRemembered() throws {
        var app = try launch()
        openCalendar(app)
        let chip = app.buttons.matching(NSPredicate(format: "label == 'Parent'")).firstMatch
        XCTAssertTrue(chip.waitForExistence(timeout: 20))
        chip.tap()
        XCTAssertFalse(chip.isSelected)
        app.terminate()

        app = try launch()
        openCalendar(app)
        let again = app.buttons.matching(NSPredicate(format: "label == 'Parent'")).firstMatch
        XCTAssertTrue(again.waitForExistence(timeout: 20))
        XCTAssertFalse(again.isSelected, "hidden people stay hidden")
        again.tap()
        XCTAssertTrue(again.isSelected)
    }
}
