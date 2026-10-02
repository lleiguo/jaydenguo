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
        // Each test starts with an empty chat.
        request("DELETE", "/api/v1/assistant/turns")
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
    private func request(_ method: String, _ path: String) -> Data? {
        var r = URLRequest(url: URL(string: "\(server)\(path)")!)
        r.httpMethod = method
        r.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
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
}
