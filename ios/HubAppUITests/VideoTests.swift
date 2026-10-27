import XCTest

/// N6 part 2 (intent 0004, IVID-1..3) against the local seed server: the
/// seeded review with its playback copy (MEDIA_DIR, see ios/README.md) and
/// an older one whose sport was detected. Relabelling clears "detected":
/// `pnpm seed` resets it.
final class VideoTests: XCTestCase {
    private var server: String { ProcessInfo.processInfo.environment["HUB_TEST_SERVER"] ?? "http://localhost:3200" }
    private let sample = "5eed0000-0000-4000-8000-000000000001"
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
        let advice = app.staticTexts["The review"]
        XCTAssertTrue(app.staticTexts["Done"].waitForExistence(timeout: 20))
        for _ in 0..<6 where !advice.exists { app.swipeUp() }
        XCTAssertTrue(advice.exists)
    }

    /// IVID-2: a jump button seeks and shows the point.
    func testAJumpButtonShowsThatMomentAndItsPoint() throws {
        let app = launch()
        app.open(URL(string: "jaydenguohub://open/videos/\(sample)")!)
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

    /// intent 0026, FS-1..4: full screen keeps the moment, its point and the
    /// speed; a frame step there carries back to the page on close.
    func testFullScreenKeepsTheMoment() throws {
        let app = launch()
        app.open(URL(string: "jaydenguohub://open/videos/\(sample)")!)
        XCTAssertTrue(element(app, "videoTime").waitForExistence(timeout: 30), "the playback copy loads")
        let jump = app.buttons["Show 0:02 in the video"].firstMatch
        for _ in 0..<6 where !jump.isHittable { app.swipeUp() }
        jump.tap()
        let open = app.buttons["openFullScreen"]
        for _ in 0..<6 where !open.isHittable { app.swipeDown() }
        open.tap()

        let time = element(app, "fullScreenTime")
        XCTAssertTrue(time.waitForExistence(timeout: 10), "full screen opens")
        XCTAssertEqual(time.label, "0:02")
        XCTAssertTrue(element(app, "fullScreenControls").descendants(matching: .any)["currentPoint"].label.hasPrefix("Fix 1"))
        XCTAssertFalse(app.tabBars.firstMatch.isHittable, "full screen covers the tab bar")
        let controls = element(app, "fullScreenControls")
        controls.buttons["Half speed"].tap()
        controls.buttons["Forward one frame"].tap()

        // FS-2: sideways, the controls are still there.
        XCUIDevice.shared.orientation = .landscapeLeft
        XCTAssertTrue(controls.buttons["Back one frame"].waitForHittable(timeout: 5))
        XCUIDevice.shared.orientation = .portrait
        app.buttons["closeFullScreen"].tap()
        let pageTime = element(app, "videoTime")
        XCTAssertTrue(pageTime.waitForExistence(timeout: 10))
        XCTAssertEqual(pageTime.label, "0:02", "one frame on stays at 0:02")
        XCTAssertTrue(app.buttons["Half speed"].isSelected, "the speed carries back")
    }
    /// intent 0026, ASK-1..4, ASK-10: a spoken question lands in the box,
    /// a typed one is asked and answered, and its time jumps the clip.
    /// Each run adds an answer to the sample: `pnpm seed` clears them.
    func testAskAboutTheVideo() throws {
        let app = XCUIApplication()
        let clip = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
            .appendingPathComponent("tests/fixtures/assistant/question.m4a")
        app.launchArguments = ["-HubBaseURL", server, "-HubUITestToken", token, "-HubNoLock",
                               "-HubCookieClip", try Data(contentsOf: clip).base64EncodedString()]
        app.launch()
        XCTAssertTrue(app.navigationBars["Today"].waitForExistence(timeout: 20))
        app.open(URL(string: "jaydenguohub://open/videos/\(sample)")!)
        XCTAssertTrue(element(app, "videoTime").waitForExistence(timeout: 30), "the playback copy loads")

        let field = element(app, "questionField")
        for _ in 0..<10 where !field.isHittable { app.swipeUp() }
        if element(app, "cannotAsk").exists {
            throw XCTSkip("The sample has had its questions: run `pnpm seed` to clear them.")
        }
        // The stand-in transcriber hears "What's on today?" in any clip.
        element(app, "questionMic").press(forDuration: 1.2)
        XCTAssertTrue(field.waitForValue("What's on today?", timeout: 15), String(describing: field.value))

        field.clearText()
        field.typeText("Is his elbow high at contact?")
        app.buttons["askQuestion"].tap()
        let answer = app.descendants(matching: .any)
            .matching(NSPredicate(format: "label CONTAINS %@", "The elbow stays high")).firstMatch
        XCTAssertTrue(answer.waitForExistence(timeout: 60), "the stand-in model answers")
        // The review's good point is at 0:03 too; the answer's comes last.
        let jumps = app.buttons.matching(identifier: "Show 0:03 in the video")
        let jump = jumps.element(boundBy: jumps.count - 1)
        for _ in 0..<6 where !jump.isHittable { app.swipeUp() }
        jump.tap()
        let point = element(app, "currentPoint")
        for _ in 0..<10 where !point.isHittable { app.swipeDown() }
        XCTAssertTrue(point.label.hasPrefix("Answer"), point.label)
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
        app.buttons["Paste a link"].tap()
        let link = app.textFields["videoLink"]
        XCTAssertTrue(link.waitForExistence(timeout: 10))
        link.tap()
        link.typeText("https://youtu.be/dQw4w9WgXcQ")
        let noteField = app.textFields["Note or question (what to look at)"]
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

    func waitForValue(_ value: String, timeout: TimeInterval = 5) -> Bool {
        let predicate = NSPredicate(format: "value == %@", value)
        return XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: predicate, object: self)], timeout: timeout) == .completed
    }

    /// Taps at the end of the text, then deletes it all.
    func clearText() {
        coordinate(withNormalizedOffset: CGVector(dx: 0.98, dy: 0.5)).tap()
        guard let text = value as? String, !text.isEmpty else { return }
        typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: text.count))
    }

    func waitForHittable(timeout: TimeInterval = 5) -> Bool {
        let predicate = NSPredicate(format: "hittable == true")
        return XCTWaiter.wait(for: [XCTNSPredicateExpectation(predicate: predicate, object: self)], timeout: timeout) == .completed
    }
}
