import XCTest

/// N6 part 2 (intent 0004, IVID-1..3) against the local seed server: the
/// seeded debate with its playback copy (MEDIA_DIR, see ios/README.md) and
/// an older single-model review whose sport was detected. The vote can
/// only be cast once, and relabelling clears "detected": `pnpm seed` resets
/// both.
final class VideoTests: XCTestCase {
    private var server: String { ProcessInfo.processInfo.environment["HUB_TEST_SERVER"] ?? "http://localhost:3200" }
    private let debate = "5eed0000-0000-4000-8000-000000000001"
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

    private func element(_ app: XCUIApplication, _ id: String) -> XCUIElement {
        app.descendants(matching: .any).matching(identifier: id).firstMatch
    }

    func testHistoryAndTheReview() throws {
        let app = launch()
        app.tabBars.buttons["More"].tap()
        app.buttons["Videos"].tap()
        XCTAssertTrue(app.navigationBars["Videos"].waitForExistence(timeout: 10))
        let rows = app.buttons.matching(identifier: "videoRow")
        XCTAssertTrue(rows.firstMatch.waitForExistence(timeout: 20))
        XCTAssertGreaterThanOrEqual(rows.count, 2)
        rows.firstMatch.tap()
        // The player comes first; the advice is below it.
        let advice = app.staticTexts["The advice"]
        XCTAssertTrue(app.staticTexts["Done"].waitForExistence(timeout: 20))
        for _ in 0..<6 where !advice.exists { app.swipeUp() }
        XCTAssertTrue(advice.exists)
        let verdict = app.staticTexts["Verdict"]
        for _ in 0..<8 where !verdict.exists { app.swipeUp() }
        XCTAssertTrue(verdict.exists)
        let geminiReview = app.buttons["Gemini's review"]
        for _ in 0..<6 where !geminiReview.exists { app.swipeUp() }
        XCTAssertTrue(geminiReview.exists, "each model's own review is there too")
    }

    /// IVID-2: a jump button seeks and shows the point.
    func testAJumpButtonShowsThatMomentAndItsPoint() throws {
        let app = launch()
        app.open(URL(string: "jaydenguohub://open/videos/\(debate)")!)
        let time = element(app, "videoTime")
        XCTAssertTrue(time.waitForExistence(timeout: 30), "the playback copy loads")
        let jump = app.buttons["Show 0:02 in the video"].firstMatch
        for _ in 0..<6 where !jump.isHittable { app.swipeUp() }
        jump.tap()
        for _ in 0..<6 where !time.isHittable { app.swipeDown() }
        XCTAssertTrue(time.label == "0:02" || time.waitForLabel("0:02"), time.label)
        let point = element(app, "currentPoint")
        XCTAssertTrue(point.label.hasPrefix("Fix 1"), point.label)
    }

    func testVoteOnce() throws {
        let app = launch()
        app.open(URL(string: "jaydenguohub://open/videos/\(debate)")!)
        XCTAssertTrue(app.staticTexts["Done"].waitForExistence(timeout: 20))
        let voted = element(app, "yourVote")
        let claude = app.buttons["Claude"]
        for _ in 0..<12 where !(voted.exists || claude.isHittable) { app.swipeUp() }
        if voted.exists { throw XCTSkip("Already voted: run `pnpm seed` to reset the sample vote.") }
        claude.tap()
        XCTAssertTrue(app.staticTexts["You found Claude's review more useful."].waitForExistence(timeout: 10))
    }

    /// intent 0005, SPT-4..6: the seeded older review's sport was detected;
    /// change only its label, then change it back.
    func testChangeTheSportLabel() throws {
        let older = "5eed0000-0000-4000-8000-000000000002"
        cleanups.append { [self] in
            var r = URLRequest(url: URL(string: "\(server)/api/v1/videos/\(older)")!)
            r.httpMethod = "PATCH"
            r.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
            r.setValue("application/json", forHTTPHeaderField: "Content-Type")
            r.httpBody = #"{"sport":"tennis"}"#.data(using: .utf8)
            _ = fetch(r)
        }
        let app = launch()
        app.open(URL(string: "jaydenguohub://open/videos/\(older)")!)
        let title = app.navigationBars.matching(NSPredicate(format: "identifier BEGINSWITH 'Tennis'")).firstMatch
        XCTAssertTrue(title.waitForExistence(timeout: 20))
        if !title.identifier.hasPrefix("Tennis (detected)") {
            throw XCTSkip("Already relabelled: run `pnpm seed` to reset the sample's detected sport.")
        }
        XCTAssertTrue(app.staticTexts["Worked out from the video."].exists)

        func choose(_ sport: String) {
            element(app, "sportPicker").tap()
            app.buttons[sport].firstMatch.tap()
            let label = app.buttons["Only change the label"]
            XCTAssertTrue(label.waitForExistence(timeout: 5), "a finished review asks first")
            XCTAssertTrue(app.buttons["Review again as \(sport)"].exists)
            label.tap()
        }
        choose("Swimming")
        XCTAssertTrue(app.navigationBars.matching(NSPredicate(format: "identifier BEGINSWITH 'Swimming ·'")).firstMatch.waitForExistence(timeout: 10))
        choose("Tennis")
        XCTAssertTrue(app.navigationBars.matching(NSPredicate(format: "identifier BEGINSWITH 'Tennis ·'")).firstMatch.waitForExistence(timeout: 10))
        XCTAssertFalse(app.staticTexts["Worked out from the video."].exists)
    }

    func testSaveALinkThenDeleteAndRestore() throws {
        let note = "UI test link \(Int.random(in: 1000...9999))"
        cleanups.append { [self] in
            let list = request("GET", "/api/v1/videos").flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] }
            for r in (list?["reviews"] as? [[String: Any]]) ?? [] where r["note"] as? String == note {
                request("DELETE", "/api/v1/videos/\(r["id"] as! String)")
            }
        }
        let app = launch()
        app.tabBars.buttons["More"].tap()
        app.buttons["Videos"].tap()
        app.navigationBars.buttons["New review"].tap()
        let link = app.textFields["videoLink"]
        XCTAssertTrue(link.waitForExistence(timeout: 10))
        link.tap()
        link.typeText("https://youtu.be/dQw4w9WgXcQ")
        let noteField = app.textFields["Note (what to look at)"]
        noteField.tap()
        noteField.typeText(note)
        app.navigationBars.buttons["Review"].tap()
        XCTAssertTrue(app.staticTexts["Saved with your note."].waitForExistence(timeout: 10))

        let row = app.buttons.matching(NSPredicate(format: "identifier == 'videoRow' AND label CONTAINS %@", note)).firstMatch
        XCTAssertTrue(row.waitForExistence(timeout: 10))
        XCTAssertTrue(row.label.contains("Saved (not reviewed)"))
        row.swipeLeft()
        app.buttons["Delete"].tap()
        XCTAssertTrue(app.staticTexts["Review deleted."].waitForExistence(timeout: 10))
        XCTAssertTrue(row.waitForNonExistence(timeout: 10))

        // The toggle itself sits at the row's right-hand end.
        app.switches["Show deleted"].coordinate(withNormalizedOffset: CGVector(dx: 0.95, dy: 0.5)).tap()
        let deleted = app.buttons.matching(NSPredicate(format: "identifier == 'videoRow' AND label CONTAINS %@", note)).firstMatch
        XCTAssertTrue(deleted.waitForExistence(timeout: 10))
        deleted.swipeLeft()
        app.buttons["Restore"].tap()
        XCTAssertTrue(app.staticTexts["Review restored."].waitForExistence(timeout: 10))
    }
}

private extension XCUIElement {
    func waitForLabel(_ label: String, timeout: TimeInterval = 5) -> Bool {
        let predicate = NSPredicate(format: "label == %@", label)
        return XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: predicate, object: self)], timeout: timeout) == .completed
    }
}
