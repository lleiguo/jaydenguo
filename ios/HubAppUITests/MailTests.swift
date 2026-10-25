import XCTest

/// Today's mail (intent 0025, MD-5, MD-6, MT-2, MA-1) against the local seed
/// server started with ASSISTANT_LLM=fake: the seed has three emails today
/// (one routine) and two to-dos; the stand-in voice is a short tone.
final class MailTests: XCTestCase {
    private var server: String { ProcessInfo.processInfo.environment["HUB_TEST_SERVER"] ?? "http://localhost:3200" }
    private var token = ""

    override func setUpWithError() throws {
        continueAfterFailure = false
        let url = try XCTUnwrap(URL(string: "\(server)/auth/dev?client=ios"))
        let done = expectation(description: "token")
        var data: Data?
        URLSession.shared.dataTask(with: url) { d, _, _ in
            data = d
            done.fulfill()
        }.resume()
        wait(for: [done], timeout: 30)
        token = try XCTUnwrap(
            (try? JSONSerialization.jsonObject(with: XCTUnwrap(data, "is the development server running at \(server)?")) as? [String: Any])?["token"] as? String
        )
    }

    private func launch() -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["-HubBaseURL", server, "-HubUITestToken", token, "-HubNoLock"]
        app.launch()
        return app
    }

    func testTodaysMailFromTheCardToTheList() throws {
        let app = launch()
        let card = app.buttons["mailCard"]
        XCTAssertTrue(card.waitForExistence(timeout: 20), "Today shows the mail card")
        XCTAssertTrue(app.staticTexts["2 emails, 2 to do"].exists || app.staticTexts.containing(NSPredicate(format: "label CONTAINS '2 to do'")).firstMatch.exists)
        card.tap()

        let list = app.collectionViews["mailList"]
        XCTAssertTrue(list.waitForExistence(timeout: 10))
        XCTAssertTrue(app.staticTexts["Field trip form"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["Extra practice next week"].exists)
        // The receipt is folded under "Also came in".
        XCTAssertFalse(app.staticTexts["Your receipt"].exists)
        XCTAssertTrue(app.buttons["mailApprove"].exists, "the practice email's suggestion can be approved here")

        // A to-do is ticked for both parents, and unticked again.
        let todo = app.buttons.matching(identifier: "mailTodo").firstMatch
        XCTAssertTrue(todo.exists)
        todo.tap()
        XCTAssertTrue(app.buttons.matching(NSPredicate(format: "identifier == 'mailTodo' AND selected == true")).firstMatch.waitForExistence(timeout: 10))
        app.buttons.matching(NSPredicate(format: "identifier == 'mailTodo' AND selected == true")).firstMatch.tap()
        let ticked = app.buttons.matching(NSPredicate(format: "identifier == 'mailTodo' AND selected == true")).firstMatch
        XCTAssertTrue(waitUntilGone(ticked, timeout: 10))
    }

    func testPlayingTheDayStepsThroughItsParts() throws {
        let app = launch()
        let play = app.buttons["mailCardPlay"]
        XCTAssertTrue(play.waitForExistence(timeout: 20))
        play.tap()
        // The stand-in voice is a short tone: the five parts (intro, two
        // emails, "and 1 other", the to-dos) play through and it stops on
        // the last one, paused.
        XCTAssertTrue(app.staticTexts["5 of 5"].waitForExistence(timeout: 20))
        XCTAssertTrue(app.buttons["Play"].waitForExistence(timeout: 10))
        // Back plays the fourth part again, which ends at once and moves on.
        app.buttons["Back"].tap()
        XCTAssertTrue(app.buttons["Pause"].waitForExistence(timeout: 5) || app.staticTexts["5 of 5"].exists)
        XCTAssertTrue(app.staticTexts["5 of 5"].waitForExistence(timeout: 10))
        XCTAssertTrue(app.buttons["Play"].waitForExistence(timeout: 10))
        app.buttons["Stop"].tap()
        XCTAssertTrue(waitUntilGone(app.staticTexts["5 of 5"], timeout: 5))
        XCTAssertTrue(waitUntilGone(app.buttons["Back"], timeout: 5))
    }

    private func waitUntilGone(_ element: XCUIElement, timeout: TimeInterval) -> Bool {
        let gone = expectation(for: NSPredicate(format: "exists == false"), evaluatedWith: element)
        return XCTWaiter.wait(for: [gone], timeout: timeout) == .completed
    }
}
