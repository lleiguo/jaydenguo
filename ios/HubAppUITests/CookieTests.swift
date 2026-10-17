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

    /// With `speaking`, the app "records" a fixture clip (synthetic speech),
    /// so the microphone is never used; the stand-in server hears "What's
    /// on today?" in any clip.
    private func launch(speaking: Bool = false) throws -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["-HubBaseURL", server, "-HubUITestToken", token, "-HubNoLock"]
        if speaking {
            let clip = URL(fileURLWithPath: #filePath)
                .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
                .appendingPathComponent("tests/fixtures/assistant/question.m4a")
            app.launchArguments += ["-HubCookieClip", try Data(contentsOf: clip).base64EncodedString()]
        }
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
        let app = try launch()
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
        var app = try launch()
        app.buttons["cookieButton"].tap()
        ask(app, "Hello Cookie")
        XCTAssertTrue(app.descendants(matching: .any)["cookieAnswer"].firstMatch.waitForExistence(timeout: 20))
        app.terminate()

        app = try launch()
        app.buttons["cookieButton"].tap()
        let question = app.descendants(matching: .any)["cookieQuestion"].firstMatch
        XCTAssertTrue(question.waitForExistence(timeout: 20))
        XCTAssertEqual(question.label, "You asked: Hello Cookie")
    }

    /// Intent 0019, SHT-3, SHSEC-1: text longer than a question becomes
    /// something shared; the question shows what kind it was, and the
    /// stand-in model says what she read.
    func testALongPasteIsSharedNotAsked() throws {
        let app = try launch()
        app.buttons["cookieButton"].tap()
        let field = app.textFields["cookieField"].firstMatch.exists ? app.textFields["cookieField"].firstMatch : app.textViews["cookieField"].firstMatch
        XCTAssertTrue(field.waitForExistence(timeout: 10))
        field.tap()
        // One past the question limit: typed (not pasted), the 501st
        // character moves it all out of the field.
        let message = String(("Practice moved to Saturday at 9. " + String(repeating: "Bring water and shin pads. ", count: 18)).prefix(501))
        field.typeText(message)
        let attachment = app.descendants(matching: .any)["cookieAttachment"].firstMatch
        XCTAssertTrue(attachment.waitForExistence(timeout: 10))
        XCTAssertTrue(attachment.label.hasPrefix("Pasted text, "), attachment.label)

        // Removing it and pasting again is fine; then it's sent with no words.
        app.buttons["cookieRemoveAttachment"].tap()
        XCTAssertFalse(attachment.exists)
        field.typeText(message)
        XCTAssertTrue(attachment.waitForExistence(timeout: 10))
        app.buttons["cookieSend"].tap()
        let answer = app.descendants(matching: .any)["cookieAnswer"].firstMatch
        XCTAssertTrue(answer.waitForExistence(timeout: 20))
        XCTAssertTrue(answer.label.contains("You shared a text starting"), answer.label)
        XCTAssertTrue(answer.label.contains("From what you shared"), answer.label)
        let question = app.descendants(matching: .any)["cookieQuestion"].firstMatch
        XCTAssertTrue(question.label.contains("Pasted text, "), question.label)

        // After a restart, history names it and holds none of it.
        app.terminate()
        let again = try launch()
        again.buttons["cookieButton"].tap()
        let asked = again.descendants(matching: .any)["cookieQuestion"].firstMatch
        XCTAssertTrue(asked.waitForExistence(timeout: 20))
        XCTAssertTrue(asked.label.hasPrefix("You asked: Pasted text, "), asked.label)
        XCTAssertFalse(asked.label.contains("shin pads"), asked.label)
    }

    /// Intent 0019, SHT-1, SHT-2: a screenshot "from Photos", shrunk and
    /// sent with words. The system picker runs in another process, so the
    /// app is handed a made-up screenshot (`-HubCookiePicture`, debug only).
    func testAScreenshotIsSentWithTheQuestion() throws {
        let picture = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
            .appendingPathComponent("tests/fixtures/assistant/shared/practice.jpg")
        let app = XCUIApplication()
        app.launchArguments = [
            "-HubBaseURL", server, "-HubUITestToken", token, "-HubNoLock",
            "-HubCookiePicture", try Data(contentsOf: picture).base64EncodedString(),
        ]
        app.launch()
        XCTAssertTrue(app.navigationBars["Today"].waitForExistence(timeout: 20))
        app.buttons["cookieButton"].tap()
        app.buttons["cookieAttach"].tap()
        app.buttons["Choose Photos"].tap()
        let attachment = app.descendants(matching: .any)["cookieAttachment"].firstMatch
        XCTAssertTrue(attachment.waitForExistence(timeout: 20))
        XCTAssertEqual(attachment.label, "1 screenshot")
        ask(app, "what is this?")
        let answer = app.descendants(matching: .any)["cookieAnswer"].firstMatch
        XCTAssertTrue(answer.waitForExistence(timeout: 20))
        XCTAssertTrue(answer.label.contains("You shared 1 picture."), answer.label)
        let question = app.descendants(matching: .any)["cookieQuestion"].firstMatch
        XCTAssertTrue(question.label.contains("what is this? · 1 screenshot"), question.label)
        XCTAssertFalse(attachment.exists)
    }

    /// Intent 0008, plan E3.2: an added event is a card under the answer;
    /// it opens the event, which says it is being added; Undo takes it
    /// back. Needs the server started with ASSISTANT_CALENDAR_ADD=fake
    /// (launch config `web-cookie-add`) and the seed's household calendar.
    func testAddingAnEventAndUndo() throws {
        let sources = request("GET", "/api/v1/sources")
            .flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] }?["sources"] as? [[String: Any]]
        let household = try XCTUnwrap(
            sources?.first { $0["name"] as? String == "Household calendar (sample)" }?["id"] as? String,
            "run `pnpm seed`"
        )
        request("PATCH", "/api/v1/assistant/settings", body: #"{"addCalendarSourceId":"\#(household)"}"#)
        defer { request("PATCH", "/api/v1/assistant/settings", body: #"{"addCalendarSourceId":null}"#) }
        // Two weeks ahead, so it's never in the past or too far off.
        let day = Date.now.addingTimeInterval(14 * 86_400).formatted(.iso8601.year().month().day())

        let app = try launch()
        app.buttons["cookieButton"].tap()
        ask(app, "Add dentist for Brother on \(day) at 18:00")
        let answer = app.descendants(matching: .any)["cookieAnswer"].firstMatch
        XCTAssertTrue(answer.waitForExistence(timeout: 20))
        // The title carries whose it is (GCW-6).
        XCTAssertTrue(answer.label.contains("Adding: Brother dentist"), answer.label)
        let card = app.descendants(matching: .any)["cookieCard"].firstMatch
        XCTAssertTrue(card.waitForExistence(timeout: 10))
        XCTAssertTrue(card.label.hasPrefix("Brother dentist. "), card.label)
        XCTAssertTrue(card.label.contains("For Brother"), card.label)
        // The stand-in Google never writes, so it stays on its way.
        XCTAssertTrue(card.label.contains("Being added to the family calendar"), card.label)

        // The card opens the event on the calendar.
        card.tap()
        let mark = app.descendants(matching: .any)["eventBeingAdded"].firstMatch
        XCTAssertTrue(mark.waitForExistence(timeout: 20))
        XCTAssertTrue(app.tabBars.buttons["Calendar"].isSelected)
        app.buttons["Done"].firstMatch.tap()

        // Undo, back in the chat.
        app.buttons["cookieButton"].tap()
        let undo = app.buttons["cookieChangeUndo"].firstMatch
        XCTAssertTrue(undo.waitForExistence(timeout: 10))
        XCTAssertEqual(undo.label, "Undo adding Brother dentist")
        undo.tap()
        let undone = app.descendants(matching: .any).matching(
            NSPredicate(format: "identifier == 'cookieCard' AND label CONTAINS 'Undone'")
        ).firstMatch
        XCTAssertTrue(undone.waitForExistence(timeout: 10))
        XCTAssertFalse(undo.exists)
    }

    /// Intent 0008, plan E5.4: today's email suggestions applied at once.
    /// The seed's moved game is applied and shown as a card; its extra
    /// practice, unsure of the place, is left. Undo puts it back. Needs a
    /// fresh `pnpm seed` (the sample emails count as today's).
    func testApplyingTodaysEmailAndUndo() throws {
        let app = try launch()
        app.buttons["cookieButton"].tap()
        ask(app, "Update my calendar from today's email")
        let answer = app.descendants(matching: .any)["cookieAnswer"].firstMatch
        XCTAssertTrue(answer.waitForExistence(timeout: 20))
        XCTAssertTrue(answer.label.contains("1 moved"), answer.label)
        XCTAssertTrue(answer.label.contains("1 left"), answer.label)
        let card = app.descendants(matching: .any)["cookieCard"].firstMatch
        XCTAssertTrue(card.waitForExistence(timeout: 10))
        XCTAssertTrue(card.label.hasPrefix("Game vs Green Giants. "), card.label)
        XCTAssertTrue(card.label.contains("Moved, as the email said"), card.label)

        let undo = app.buttons["cookieChangeUndo"].firstMatch
        XCTAssertTrue(undo.waitForExistence(timeout: 10))
        XCTAssertEqual(undo.label, "Undo moving Game vs Green Giants")
        undo.tap()
        let undone = app.descendants(matching: .any).matching(
            NSPredicate(format: "identifier == 'cookieCard' AND label CONTAINS 'Undone'")
        ).firstMatch
        XCTAssertTrue(undone.waitForExistence(timeout: 10))
    }

    /// Intent 0009, plan R3.2: asked about an email, she says she's checking,
    /// the chat shows it waiting, and her follow-up arrives in place. The
    /// seed's email source has no Google account, so the follow-up is that
    /// Gmail isn't connected: still a follow-up, from the worker. Needs the
    /// server with ASSISTANT_LLM=fake (launch config `web-cookie-email`).
    func testReadingAnEmailFollowsUp() throws {
        let sources = request("GET", "/api/v1/sources")
            .flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] }?["sources"] as? [[String: Any]]
        let mail = try XCTUnwrap(
            sources?.first { $0["name"] as? String == "Coach email (sample)" }?["id"] as? String, "run `pnpm seed`"
        )
        request("PATCH", "/api/v1/sources/\(mail)", body: #"{"enabled":true}"#)
        defer { request("PATCH", "/api/v1/sources/\(mail)", body: #"{"enabled":false}"#) }

        let app = try launch()
        app.buttons["cookieButton"].tap()
        ask(app, "Summarize the email about extra practice")
        let answer = app.descendants(matching: .any)["cookieAnswer"].firstMatch
        XCTAssertTrue(answer.waitForExistence(timeout: 20))
        XCTAssertTrue(answer.label.contains("checking the mail"), answer.label)
        let waiting = app.descendants(matching: .any)["cookieWaiting"].firstMatch
        XCTAssertTrue(waiting.waitForExistence(timeout: 5))

        let followup = app.descendants(matching: .any).matching(
            NSPredicate(format: "identifier == 'cookieAnswer' AND label CONTAINS 'Gmail'")
        ).firstMatch
        XCTAssertTrue(followup.waitForExistence(timeout: 45), "the worker's follow-up arrives in the chat")
        XCTAssertTrue(waiting.waitForNonExistence(timeout: 10))
    }

    /// LIM-5, MEM-9: Settings → Cookie shows the month's spend and limit,
    /// and clears the chat.
    func testSettingsShowTheLimitAndClearTheChat() throws {
        let app = try launch()
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

        // Below the other sections: Form rows load as they scroll in.
        let clear = app.buttons["cookieClear"]
        for _ in 0..<4 where !(clear.exists && clear.isHittable) { app.swipeUp() }
        clear.tap()
        app.buttons["Clear history"].firstMatch.tap()
        XCTAssertTrue(app.staticTexts["Cookie's history is cleared."].waitForExistence(timeout: 10))

        app.buttons["cookieButton"].tap()
        XCTAssertTrue(app.textFields["cookieField"].firstMatch.waitForExistence(timeout: 10) || app.textViews["cookieField"].firstMatch.exists)
        XCTAssertFalse(app.descendants(matching: .any)["cookieQuestion"].firstMatch.exists)
    }

    /// MEM-2, MEM-4: a fact saved in the chat can be undone there, and the
    /// Memory list adds, shows and forgets facts.
    func testRememberingUndoAndTheMemoryList() throws {
        let app = try launch()
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
        let memory = app.buttons["cookieMemoryLink"]
        XCTAssertTrue(app.navigationBars["Cookie"].waitForExistence(timeout: 10))
        for _ in 0..<4 where !(memory.waitForExistence(timeout: 2) && memory.isHittable) { app.swipeUp() }
        memory.tap()
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
        let app = try launch()
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

    /// CK-2, CK-3, VOX-2: holding her button asks out loud; what she heard
    /// and her answer show in a bubble, and tapping it opens the chat.
    func testHoldingTheButtonAsksOutLoud() throws {
        let app = try launch(speaking: true)
        let button = app.buttons["cookieButton"]
        XCTAssertTrue(button.waitForExistence(timeout: 10))
        button.press(forDuration: 1.5)

        let bubble = app.buttons["cookieBubble"].firstMatch
        XCTAssertTrue(bubble.waitForExistence(timeout: 20))
        XCTAssertTrue(bubble.label.hasPrefix("You asked: What's on today?"), bubble.label)
        XCTAssertTrue(bubble.label.contains("From Today"), bubble.label)
        // The chat wasn't opened by the hold.
        XCTAssertFalse(app.navigationBars["Cookie"].exists)

        bubble.tap()
        XCTAssertTrue(app.navigationBars["Cookie"].waitForExistence(timeout: 10))
        let question = app.descendants(matching: .any)["cookieQuestion"].firstMatch
        XCTAssertTrue(question.waitForExistence(timeout: 10))
        XCTAssertEqual(question.label, "You asked: What's on today?")
        XCTAssertTrue(app.descendants(matching: .any)["cookieAnswer"].firstMatch.exists)
    }

    /// CK-2: a press too short to be a question is thrown away, with a hint.
    func testAShortPressIsNotAQuestion() throws {
        let app = try launch(speaking: true)
        let button = app.buttons["cookieButton"]
        XCTAssertTrue(button.waitForExistence(timeout: 10))
        button.press(forDuration: 0.4)
        let hint = app.descendants(matching: .any)["cookieHint"].firstMatch
        XCTAssertTrue(hint.waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["Hold to talk"].exists)
        XCTAssertFalse(app.navigationBars["Cookie"].exists)
    }

    /// CK-5, VOX-5: the chat's mic button needs no long press (tap to start,
    /// tap to send), and "Spoken answers" can be switched off.
    func testTheMicButtonAndSpokenAnswers() throws {
        request("PATCH", "/api/v1/assistant/settings", body: #"{"speak":true}"#)
        let app = try launch(speaking: true)
        app.buttons["cookieButton"].tap()
        let mic = app.buttons["cookieMic"]
        XCTAssertTrue(mic.waitForExistence(timeout: 10))
        XCTAssertEqual(mic.label, "Speak to Cookie")
        mic.tap()
        XCTAssertTrue(app.descendants(matching: .any)["cookieListening"].firstMatch.waitForExistence(timeout: 5))
        XCTAssertEqual(mic.label, "Stop and send")
        mic.tap()
        let question = app.descendants(matching: .any)["cookieQuestion"].firstMatch
        XCTAssertTrue(question.waitForExistence(timeout: 20))
        XCTAssertEqual(question.label, "You asked: What's on today?")
        XCTAssertTrue(app.descendants(matching: .any)["cookieAnswer"].firstMatch.waitForExistence(timeout: 10))
        app.buttons["Done"].tap()

        app.tabBars.buttons["More"].tap()
        let row = app.collectionViews.buttons["Cookie"].firstMatch
        for _ in 0..<4 where !row.isHittable { app.swipeUp() }
        row.tap()
        let toggle = app.switches["cookieSpeak"].firstMatch
        XCTAssertTrue(toggle.waitForExistence(timeout: 10))
        XCTAssertEqual(toggle.value as? String, "1")
        toggle.switches.firstMatch.exists ? toggle.switches.firstMatch.tap() : toggle.tap()
        let deadline = Date.now.addingTimeInterval(10)
        while toggle.value as? String != "0", Date.now < deadline { usleep(200_000) }
        XCTAssertEqual(toggle.value as? String, "0")
        request("PATCH", "/api/v1/assistant/settings", body: #"{"speak":true}"#)
    }
}
