import XCTest

/// N6 part 1 (intent 0004, ISCH-1, IEML-1, APP-3, SEC-5) against the local
/// seed server. What a test adds is removed through the API afterwards.
/// Suggestions are used up by approving and rejecting: `pnpm seed` puts them
/// back.
final class MoreTests: XCTestCase {
    private var server: String { ProcessInfo.processInfo.environment["HUB_TEST_SERVER"] ?? "http://localhost:3200" }
    private var token = ""
    private var cleanups: [() -> Void] = []

    override func setUpWithError() throws {
        continueAfterFailure = false
        token = try devToken()
    }

    override func tearDown() {
        cleanups.forEach { $0() }
        cleanups = []
        super.tearDown()
    }

    // MARK: Server helpers

    private func devToken() throws -> String {
        let url = try XCTUnwrap(URL(string: "\(server)/auth/dev?client=ios"))
        let data = try XCTUnwrap(fetch(URLRequest(url: url)), "is the development server running at \(server)?")
        return try XCTUnwrap((try? JSONSerialization.jsonObject(with: data) as? [String: Any])?["token"] as? String)
    }

    private func fetch(_ request: URLRequest) -> Data? {
        let done = expectation(description: "request")
        var result: Data?
        URLSession.shared.dataTask(with: request) { data, _, _ in
            result = data
            done.fulfill()
        }.resume()
        wait(for: [done], timeout: 30)
        return result
    }

    @discardableResult
    private func request(_ method: String, _ path: String) -> Data? {
        var r = URLRequest(url: URL(string: "\(server)\(path)")!)
        r.httpMethod = method
        r.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        return fetch(r)
    }

    private func json(_ path: String) -> [String: Any]? {
        request("GET", path).flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] }
    }

    // MARK: App helpers

    private func launch() -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["-HubBaseURL", server, "-HubUITestToken", token, "-HubNoLock"]
        app.launch()
        XCTAssertTrue(app.navigationBars["Today"].waitForExistence(timeout: 20))
        app.tabBars.buttons["More"].tap()
        XCTAssertTrue(app.navigationBars["More"].waitForExistence(timeout: 10))
        return app
    }

    private func open(_ app: XCUIApplication, _ row: String) {
        let button = app.buttons[row].firstMatch
        for _ in 0..<4 where !button.isHittable { app.swipeUp() }
        button.tap()
        XCTAssertTrue(app.navigationBars[row].waitForExistence(timeout: 10), row)
    }

    private func element(_ app: XCUIApplication, _ id: String) -> XCUIElement {
        app.descendants(matching: .any).matching(identifier: id).firstMatch
    }

    // MARK: Tests

    func testSchoolShowsTheDayAndKeyDates() throws {
        let app = launch()
        open(app, "School")
        let period = element(app, "schoolPeriod")
        XCTAssertTrue(period.waitForExistence(timeout: 20))
        XCTAssertTrue(period.label.contains("Math") && period.label.contains("Ms Rivera"), period.label)
        let closure = element(app, "keyDate")
        for _ in 0..<4 where !closure.exists { app.swipeUp() }
        XCTAssertTrue(closure.label.contains("PD day"), "the seeded closure is a key date")
    }

    func testApproveAnEditedSuggestionAndRejectAnother() throws {
        let pending = (json("/api/v1/suggestions")?["pending"] as? Int) ?? 0
        guard pending >= 2 else { throw XCTSkip("Run `pnpm seed` on the test database to put the sample suggestions back.") }
        // The approved event belongs to the sample email source and can't be
        // deleted through the API; `pnpm seed` removes it with the reset.
        let title = "UI test practice \(Int.random(in: 1000...9999))"

        let app = launch()
        open(app, "Suggestions")
        let new = app.buttons.matching(NSPredicate(format: "identifier == 'suggestion' AND label BEGINSWITH 'New event'")).firstMatch
        XCTAssertTrue(new.waitForExistence(timeout: 20))
        XCTAssertTrue(new.label.contains("Check the place"), "an unsure field is marked")
        new.tap()
        let field = app.textFields["Title"]
        XCTAssertTrue(field.waitForExistence(timeout: 10))
        field.tap()
        field.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: 40) + title)
        let approve = app.buttons["Approve"]
        for _ in 0..<4 where !approve.isHittable { app.swipeUp() }
        approve.tap()
        XCTAssertTrue(app.staticTexts["Added to the calendar."].waitForExistence(timeout: 10))

        let change = app.buttons.matching(NSPredicate(format: "identifier == 'suggestion' AND label BEGINSWITH 'Change'")).firstMatch
        XCTAssertTrue(change.waitForExistence(timeout: 10))
        change.swipeLeft()
        app.buttons["Reject"].tap()
        XCTAssertTrue(app.staticTexts["Rejected."].waitForExistence(timeout: 10))
        XCTAssertTrue(app.staticTexts["Nothing to review"].waitForExistence(timeout: 10))
    }

    /// SEC-5: a saved password never comes back from the API or shows on screen.
    func testASavedPasswordIsNeverShown() throws {
        let secret = "UiTestSecret-\(Int.random(in: 100_000...999_999))"
        let label = "UI test login \(Int.random(in: 1000...9999))"
        cleanups.append { [self] in
            let creds = (json("/api/v1/credentials")?["credentials"] as? [[String: Any]]) ?? []
            for c in creds where c["label"] as? String == label { request("DELETE", "/api/v1/credentials/\(c["id"] as! String)") }
        }

        let app = launch()
        open(app, "Accounts")
        let add = app.buttons.matching(identifier: "Add").element(boundBy: 4) // Commit Swimming
        for _ in 0..<6 where !add.isHittable { app.swipeUp() }
        add.tap()
        XCTAssertTrue(app.navigationBars["Commit Swimming"].waitForExistence(timeout: 10))
        app.textFields["Name"].tap()
        app.textFields["Name"].typeText(label)
        app.textFields["Username"].tap()
        app.textFields["Username"].typeText("uitest")
        let secretField = app.secureTextFields["secretField"]
        secretField.tap()
        secretField.typeText(secret)
        app.navigationBars.buttons["Save"].tap()
        XCTAssertTrue(app.staticTexts["\(label) saved."].waitForExistence(timeout: 10))

        let row = app.buttons.matching(NSPredicate(format: "identifier == 'credential' AND label CONTAINS %@", label)).firstMatch
        for _ in 0..<6 where !row.isHittable { app.swipeUp() }
        row.tap()
        XCTAssertTrue(app.navigationBars[label].waitForExistence(timeout: 10))
        let masked = app.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS 'hidden'")).firstMatch
        XCTAssertTrue(masked.exists, "the password shows only as hidden")
        let shown = app.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS %@ OR value CONTAINS %@", secret, secret))
        XCTAssertEqual(shown.count, 0, "the password is never on screen")

        let everything = String(decoding: request("GET", "/api/v1/credentials") ?? Data(), as: UTF8.self)
        XCTAssertTrue(everything.contains(label))
        XCTAssertFalse(everything.contains(secret), "the API never returns it")
    }

    func testSettingsScreensOpen() throws {
        let app = launch()
        open(app, "Sources")
        XCTAssertTrue(element(app, "source").waitForExistence(timeout: 20))
        let tennis = app.buttons.matching(NSPredicate(format: "identifier == 'source' AND label BEGINSWITH 'Tennis site (sample)'")).firstMatch
        tennis.tap()
        XCTAssertTrue(app.staticTexts["Recent syncs"].waitForExistence(timeout: 10))
        XCTAssertFalse(app.buttons["Refresh now"].isEnabled, "a switched-off source can't be refreshed")
        app.navigationBars.buttons.element(boundBy: 0).tap()
        app.navigationBars.buttons.element(boundBy: 0).tap()

        for (row, id) in [("People", "person"), ("Clashes", "clash"), ("Deleted", "deletedEvent"), ("Costs", "costsList")] {
            open(app, row)
            XCTAssertTrue(element(app, id).waitForExistence(timeout: 20), row)
            app.navigationBars.buttons.element(boundBy: 0).tap()
            XCTAssertTrue(app.navigationBars["More"].waitForExistence(timeout: 10))
        }
        open(app, "Sessions")
        XCTAssertTrue(app.staticTexts["This phone"].waitForExistence(timeout: 20))
        app.navigationBars.buttons.element(boundBy: 0).tap()
        open(app, "General")
        let zone = app.descendants(matching: .any).matching(NSPredicate(format: "label CONTAINS 'America/Toronto'")).firstMatch
        XCTAssertTrue(zone.waitForExistence(timeout: 10))
    }
}
