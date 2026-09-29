import XCTest

/// N4 (intent 0004, ITEN-1, ISWM-1, APP-6) against the local seed server.
/// Corrections made here are put back through the API afterwards, even if
/// a test fails, so the seed data stays as it was.
final class SportsTests: XCTestCase {
    private var server: String { ProcessInfo.processInfo.environment["HUB_TEST_SERVER"] ?? "http://localhost:3200" }
    private var token = ""

    override func setUpWithError() throws {
        continueAfterFailure = false
        token = try devToken()
    }

    override func tearDown() {
        // Drop any correction a test left behind (TEN-8, SWM-7).
        for (list, key, path) in [("/api/v1/tennis/results", "rows", "tennis/matches"), ("/api/v1/swim/results", "results", "swim/results")] {
            let rows = (json(list)?[key] as? [[String: Any]]) ?? []
            for row in rows {
                let item = (row["match"] as? [String: Any]) ?? row
                if item["corrected"] as? Bool == true, let id = item["id"] as? String {
                    _ = request("POST", "/api/v1/\(path)/\(id)/use-source")
                }
            }
        }
        super.tearDown()
    }

    // MARK: Server helpers

    private func devToken() throws -> String {
        let url = try XCTUnwrap(URL(string: "\(server)/auth/dev?client=ios"))
        let data = try XCTUnwrap(fetch(URLRequest(url: url)), "is the development server running at \(server)?")
        let token = (try? JSONSerialization.jsonObject(with: data) as? [String: Any])?["token"] as? String
        return try XCTUnwrap(token)
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
        return app
    }

    private func text(_ app: XCUIApplication, beginningWith prefix: String) -> XCUIElement {
        app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@", prefix)).firstMatch
    }

    /// A list row whose combined label contains the text.
    private func listRow(_ app: XCUIApplication, _ id: String, containing text: String) -> XCUIElement {
        app.buttons.matching(NSPredicate(format: "identifier == %@ AND label CONTAINS %@", id, text)).firstMatch
    }

    private func scrollTo(_ element: XCUIElement, in app: XCUIApplication, times: Int = 6) {
        for _ in 0..<times where !(element.exists && element.isHittable) { app.swipeUp() }
    }

    private func replace(_ field: XCUIElement, with value: String) {
        // The fields are right-aligned: tap the end so the cursor follows the text.
        field.coordinate(withNormalizedOffset: CGVector(dx: 0.98, dy: 0.5)).tap()
        field.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: 30))
        field.typeText(value)
    }

    // MARK: Tennis

    func testTennisShowsTheNextMatchAndWhatsFound() throws {
        let app = launch()
        app.tabBars.buttons["Tennis"].tap()
        XCTAssertTrue(app.navigationBars["Tennis"].waitForExistence(timeout: 10))
        XCTAssertTrue(text(app, beginningWith: "Next: Round of 16 vs Morgan Vale").waitForExistence(timeout: 20))
        XCTAssertTrue(text(app, beginningWith: "Sam wins: ").exists, "the estimate names him")
        let enter = app.buttons["Enter on the site →"]
        scrollTo(enter, in: app)
        XCTAssertTrue(enter.exists, "a tournament found for him links to the site")
        XCTAssertTrue(app.staticTexts["Not entered yet"].exists)
    }

    func testTournamentPlayerAndAccuracyPages() throws {
        let app = launch()
        app.tabBars.buttons["Tennis"].tap()
        let next = app.buttons["nextMatch"]
        XCTAssertTrue(next.waitForExistence(timeout: 20))
        next.tap()
        XCTAssertTrue(app.navigationBars["Autumn Championship (sample)"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.staticTexts["His draws"].exists)

        app.open(URL(string: "jaydenguohub://open/tennis/players/92002")!)
        XCTAssertTrue(app.navigationBars["Morgan Vale"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.staticTexts["Head-to-head: 1–1"].waitForExistence(timeout: 10))

        app.open(URL(string: "jaydenguohub://open/tennis/accuracy")!)
        XCTAssertTrue(app.navigationBars["Accuracy"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.staticTexts["accuracySummary"].waitForExistence(timeout: 10) || app.staticTexts["No rated matches yet."].exists)
    }

    func testAScoreCorrectionShowsAtOnceThenGoesBackToTheSite() throws {
        let app = launch()
        app.open(URL(string: "jaydenguohub://open/tennis/results")!)
        XCTAssertTrue(app.navigationBars["Results"].waitForExistence(timeout: 10))
        let row = app.buttons["tennisMatch"].firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: 20))
        row.tap()

        let score = app.textFields["scoreField"]
        XCTAssertTrue(score.waitForExistence(timeout: 10))
        replace(score, with: "7-5 6-4")
        app.toolbars.buttons["Save correction"].tap()
        XCTAssertTrue(text(app, beginningWith: "Saved.").waitForExistence(timeout: 10))
        let corrected = listRow(app, "tennisMatch", containing: "won 7–5 6–4")
        XCTAssertTrue(corrected.waitForExistence(timeout: 10), "the corrected score shows at once")
        XCTAssertTrue(corrected.label.contains("corrected by you"))
        XCTAssertTrue(corrected.label.contains("the site disagrees"), "the site's score is flagged next to it")

        corrected.tap()
        let useSite = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Use the site'")).firstMatch
        XCTAssertTrue(app.buttons["Done"].waitForExistence(timeout: 10))
        scrollTo(useSite, in: app)
        XCTAssertTrue(useSite.waitForExistence(timeout: 5))
        useSite.tap()
        XCTAssertTrue(app.staticTexts["Now showing the site's result."].waitForExistence(timeout: 10))
        XCTAssertTrue(listRow(app, "tennisMatch", containing: "corrected by you").waitForNonExistence(timeout: 10))
    }

    // MARK: Swimming

    func testSwimmingPBsAndTheProgressionTable() throws {
        let app = launch()
        app.tabBars.buttons["Swimming"].tap()
        XCTAssertTrue(app.navigationBars["Swimming"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.buttons["meet"].firstMatch.waitForExistence(timeout: 20))
        let pb = app.buttons["pbRow"].firstMatch
        scrollTo(pb, in: app)
        pb.tap()

        XCTAssertTrue(app.staticTexts["Estimate"].waitForExistence(timeout: 10))
        // APP-6, NFR-9: every value in the chart is also a row VoiceOver reads.
        let values = app.descendants(matching: .any).matching(identifier: "chartValue")
        scrollTo(values.firstMatch, in: app)
        XCTAssertGreaterThan(values.count, 1)
        XCTAssertTrue(values.firstMatch.label.contains(":"), "each row reads its date and time")
        XCTAssertTrue(app.descendants(matching: .any).matching(NSPredicate(format: "label BEGINSWITH 'Estimate for '")).firstMatch.exists)
    }

    func testASwimCorrectionShowsAtOnceThenGoesBackToCommit() throws {
        let meets = try XCTUnwrap(json("/api/v1/swim/meets")?["past"] as? [[String: Any]])
        let meetId = try XCTUnwrap(meets.first?["id"] as? String)
        let app = launch()
        app.open(URL(string: "jaydenguohub://open/swimming/meets/\(meetId)")!)
        let row = app.buttons["swimResult"].firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: 20))
        row.tap()

        let time = app.textFields["timeField"]
        XCTAssertTrue(app.buttons["Done"].waitForExistence(timeout: 10))
        scrollTo(time, in: app)
        XCTAssertTrue(time.waitForExistence(timeout: 5))
        replace(time, with: "9:59.99")
        app.toolbars.buttons["Save correction"].tap()
        XCTAssertTrue(text(app, beginningWith: "Saved.").waitForExistence(timeout: 10))
        let corrected = listRow(app, "swimResult", containing: "9:59.99")
        XCTAssertTrue(corrected.waitForExistence(timeout: 10), "the corrected time shows at once")
        XCTAssertTrue(corrected.label.contains("corrected by you"))

        corrected.tap()
        let useCommit = app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Use Commit'")).firstMatch
        XCTAssertTrue(app.buttons["Done"].waitForExistence(timeout: 10))
        scrollTo(useCommit, in: app)
        XCTAssertTrue(useCommit.waitForExistence(timeout: 5))
        useCommit.tap()
        XCTAssertTrue(app.staticTexts["Now showing Commit Swimming's version."].waitForExistence(timeout: 10))
        XCTAssertTrue(listRow(app, "swimResult", containing: "9:59.99").waitForNonExistence(timeout: 10))
    }
}
