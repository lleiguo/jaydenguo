import XCTest

/// Cookie's typed chat (intent 0007, plan K2) against the local seed server
/// started with ASSISTANT_LLM=fake: the stand-in model looks at Today for
/// "today", greets, and barks at anything else.
final class CookieTests: XCTestCase {
    private var server: String { ProcessInfo.processInfo.environment["HUB_TEST_SERVER"] ?? "http://localhost:3200" }
    private var token = ""

    override func setUpWithError() throws {
        continueAfterFailure = false
        token = try devToken()
        // Each test starts with an empty chat and an empty memory.
        request("DELETE", "/api/v1/assistant/turns")
        let memories = request("GET", "/api/v1/assistant/memories")
            .flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] }?["memories"] as? [[String: Any]]
        for id in (memories ?? []).compactMap({ $0["id"] as? String }) {
            request("DELETE", "/api/v1/assistant/memories/\(id)")
        }
    }

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
    private func request(_ method: String, _ path: String, body: String? = nil) -> Data? {
        var r = URLRequest(url: URL(string: "\(server)\(path)")!)
        r.httpMethod = method
        r.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        if let body {
            r.setValue("application/json", forHTTPHeaderField: "Content-Type")
            r.httpBody = Data(body.utf8)
        }
        return fetch(r)
    }

    private func launch() -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["-HubBaseURL", server, "-HubUITestToken", token, "-HubNoLock"]
        app.launch()
        XCTAssertTrue(app.navigationBars["Today"].waitForExistence(timeout: 20))
        return app
    }

    private func ask(_ app: XCUIApplication, _ question: String) {
        let field = app.textFields["cookieField"].firstMatch.exists ? app.textFields["cookieField"].firstMatch : app.textViews["cookieField"].firstMatch
        XCTAssertTrue(field.waitForExistence(timeout: 10))
        field.tap()
        field.typeText(question)
        app.buttons["cookieSend"].tap()
    }

    /// CK-1, CK-4, CHR-2, CHR-4: the button is on every tab; a tap opens the
    /// chat; an answer names its source; an unknown gets a bark.
    func testAskingAndABark() throws {
        let app = launch()
        let button = app.buttons["cookieButton"]
        XCTAssertTrue(button.waitForExistence(timeout: 10))
        for tab in ["Calendar", "Tennis", "Swimming", "More", "Today"] {
            app.tabBars.buttons[tab].tap()
            XCTAssertTrue(button.isHittable, "Cookie's button on \(tab)")
        }

        button.tap()
        XCTAssertTrue(app.navigationBars["Cookie"].waitForExistence(timeout: 10))
        ask(app, "What's on today?")
        let answer = app.descendants(matching: .any)["cookieAnswer"].firstMatch
        XCTAssertTrue(answer.waitForExistence(timeout: 20))
        XCTAssertTrue(answer.label.contains("Cookie: "), answer.label)
        XCTAssertTrue(answer.label.contains("From Today"), answer.label)

        ask(app, "What's his shoe size?")
        let bark = app.descendants(matching: .any)["cookieBark"].firstMatch
        XCTAssertTrue(bark.waitForExistence(timeout: 20))
        XCTAssertTrue(bark.label.hasPrefix("Cookie barked: Woof!"), bark.label)

        // The chat is still there when the sheet opens again.
        app.buttons["Done"].tap()
        XCTAssertTrue(button.waitForExistence(timeout: 10))
        button.tap()
        XCTAssertTrue(app.descendants(matching: .any)["cookieBark"].firstMatch.waitForExistence(timeout: 10))
    }

    /// MEM-9: history comes back from the server after a restart.
    func testHistoryComesBackAfterARestart() throws {
        var app = launch()
        app.buttons["cookieButton"].tap()
        ask(app, "Hello Cookie")
        XCTAssertTrue(app.descendants(matching: .any)["cookieAnswer"].firstMatch.waitForExistence(timeout: 20))
        app.terminate()

        app = launch()
        app.buttons["cookieButton"].tap()
        let question = app.descendants(matching: .any)["cookieQuestion"].firstMatch
        XCTAssertTrue(question.waitForExistence(timeout: 20))
        XCTAssertEqual(question.label, "You asked: Hello Cookie")
    }

    /// LIM-5, MEM-9: Settings → Cookie shows the month's spend and limit,
    /// and clears the chat.
    func testSettingsShowTheLimitAndClearTheChat() throws {
        let app = launch()
        app.buttons["cookieButton"].tap()
        ask(app, "Hello Cookie")
        XCTAssertTrue(app.descendants(matching: .any)["cookieAnswer"].firstMatch.waitForExistence(timeout: 20))
        app.buttons["Done"].tap()

        app.tabBars.buttons["More"].tap()
        // The settings row; the floating button is "Ask Cookie".
        let row = app.collectionViews.buttons["Cookie"].firstMatch
        for _ in 0..<4 where !row.isHittable { app.swipeUp() }
        row.tap()
        XCTAssertTrue(app.navigationBars["Cookie"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.staticTexts["Spent so far"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.descendants(matching: .any)["cookieCap"].firstMatch.exists)

        app.buttons["cookieClear"].tap()
        app.buttons["Clear history"].firstMatch.tap()
        XCTAssertTrue(app.staticTexts["Cookie's history is cleared."].waitForExistence(timeout: 10))

        app.buttons["cookieButton"].tap()
        XCTAssertTrue(app.textFields["cookieField"].firstMatch.waitForExistence(timeout: 10) || app.textViews["cookieField"].firstMatch.exists)
        XCTAssertFalse(app.descendants(matching: .any)["cookieQuestion"].firstMatch.exists)
    }

    /// MEM-2, MEM-4: a fact saved in the chat can be undone there, and the
    /// Memory list adds, shows and forgets facts.
    func testRememberingUndoAndTheMemoryList() throws {
        let app = launch()
        app.buttons["cookieButton"].tap()
        ask(app, "Remember that the spare key is under the blue pot")
        let answer = app.descendants(matching: .any)["cookieAnswer"].firstMatch
        XCTAssertTrue(answer.waitForExistence(timeout: 20))
        XCTAssertTrue(answer.label.contains("From Memory"), answer.label)
        XCTAssertTrue(app.staticTexts["Saved to memory"].waitForExistence(timeout: 10))
        app.buttons["cookieUndo"].tap()
        XCTAssertTrue(app.staticTexts["Not saved after all."].waitForExistence(timeout: 10))

        // Saved again, and left.
        ask(app, "Remember that recycling goes out on Tuesday")
        XCTAssertTrue(app.staticTexts["Saved to memory"].waitForExistence(timeout: 20))
        app.buttons["Done"].tap()

        app.tabBars.buttons["More"].tap()
        let row = app.collectionViews.buttons["Cookie"].firstMatch
        for _ in 0..<4 where !row.isHittable { app.swipeUp() }
        row.tap()
        app.buttons["cookieMemoryLink"].tap()
        XCTAssertTrue(app.navigationBars["Memory"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.staticTexts["recycling goes out on Tuesday"].waitForExistence(timeout: 10))
        // The undone fact is under Forgotten, not in the list.
        XCTAssertEqual(app.buttons.matching(identifier: "cookieMemory").count, 1)
        XCTAssertTrue(app.staticTexts["the spare key is under the blue pot"].exists)

        // Add one by hand.
        app.buttons["cookieAddMemory"].tap()
        let field = app.textFields["cookieMemoryText"].firstMatch.exists ? app.textFields["cookieMemoryText"].firstMatch : app.textViews["cookieMemoryText"].firstMatch
        XCTAssertTrue(field.waitForExistence(timeout: 10))
        field.tap()
        field.typeText("Locker 12, second floor")
        app.buttons["cookieMemorySave"].tap()
        XCTAssertTrue(app.staticTexts["Locker 12, second floor"].waitForExistence(timeout: 10))
        XCTAssertEqual(app.buttons.matching(identifier: "cookieMemory").count, 2)

        // Forget it with a swipe.
        // Earlier runs leave theirs under Forgotten; this is the live row.
        app.buttons.matching(identifier: "cookieMemory")
            .matching(NSPredicate(format: "label CONTAINS %@", "Locker 12")).firstMatch.swipeLeft()
        app.buttons["Forget"].firstMatch.tap()
        XCTAssertTrue(app.staticTexts["Forgotten. It can be restored for 30 days."].waitForExistence(timeout: 10))
        XCTAssertEqual(app.buttons.matching(identifier: "cookieMemory").count, 1)
    }

    /// TOOL-17, CSEC-3: the web is off until switched on in Settings; a
    /// search's answer comes with its links; words can be kept out of
    /// searches.
    func testTheWebIsOffUntilSwitchedOn() throws {
        request("PATCH", "/api/v1/assistant/settings", body: #"{"web":false,"privateTerms":[]}"#)
        let app = launch()
        app.buttons["cookieButton"].tap()
        ask(app, "Search for pool opening hours")
        XCTAssertTrue(app.descendants(matching: .any)["cookieBark"].firstMatch.waitForExistence(timeout: 20))
        app.buttons["Done"].tap()

        app.tabBars.buttons["More"].tap()
        let row = app.collectionViews.buttons["Cookie"].firstMatch
        for _ in 0..<4 where !row.isHittable { app.swipeUp() }
        row.tap()
        let toggle = app.switches["cookieWeb"].firstMatch
        XCTAssertTrue(toggle.waitForExistence(timeout: 10))
        toggle.switches.firstMatch.exists ? toggle.switches.firstMatch.tap() : toggle.tap()

        app.buttons["cookiePrivateWords"].tap()
        let field = app.textFields["cookiePrivateWord"]
        XCTAssertTrue(field.waitForExistence(timeout: 10))
        field.tap()
        field.typeText("Maple School")
        app.buttons["cookieAddPrivateWord"].tap()
        XCTAssertTrue(app.staticTexts["Maple School"].waitForExistence(timeout: 10))

        app.buttons["cookieButton"].tap()
        ask(app, "Search for pool opening hours")
        let answer = app.descendants(matching: .any)["cookieAnswer"].firstMatch
        XCTAssertTrue(answer.waitForExistence(timeout: 20))
        XCTAssertTrue(app.staticTexts["A made-up web answer about pool opening hours."].exists)
        XCTAssertTrue(app.links["example.com"].firstMatch.exists || app.buttons["example.com"].firstMatch.exists)

        // A search naming the school is refused, so she barks.
        ask(app, "Search for Maple School term dates")
        XCTAssertTrue(app.descendants(matching: .any)["cookieBark"].firstMatch.waitForExistence(timeout: 20))
        request("PATCH", "/api/v1/assistant/settings", body: #"{"web":false,"privateTerms":[]}"#)
    }
}
