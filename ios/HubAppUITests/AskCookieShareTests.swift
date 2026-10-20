import XCTest

/// "Ask Cookie" from another app's share sheet (intent 0019, plan S3,
/// SHR-1..4), against the local seed server with the stand-in model. A
/// made-up screenshot is shared from Photos: add it to the simulator first
/// with `xcrun simctl addmedia booted tests/fixtures/assistant/shared/practice.jpg`.
final class AskCookieShareTests: XCTestCase {
    private var server: String { ProcessInfo.processInfo.environment["HUB_TEST_SERVER"] ?? "http://localhost:3200" }

    override func setUpWithError() throws {
        continueAfterFailure = false
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

    func testSummarizingAScreenshotFromPhotos() throws {
        // The app signs in once; the extension reads the shared keychain.
        let hub = XCUIApplication()
        hub.launchArguments = ["-HubBaseURL", server, "-HubUITestToken", try devToken(), "-HubNoLock"]
        hub.launch()
        XCTAssertTrue(hub.navigationBars["Today"].waitForExistence(timeout: 20))
        hub.terminate()

        let photos = XCUIApplication(bundleIdentifier: "com.apple.mobileslideshow")
        photos.terminate()
        photos.launch()
        // Photos reopens where it was left: back to the library first.
        if photos.buttons["Close"].firstMatch.waitForExistence(timeout: 2) { photos.buttons["Close"].firstMatch.tap() }
        if photos.buttons["BackButton"].firstMatch.waitForExistence(timeout: 2) { photos.buttons["BackButton"].firstMatch.tap() }
        for button in ["Continue", "Not Now", "OK"] where photos.buttons[button].waitForExistence(timeout: 2) {
            photos.buttons[button].tap()
        }
        // The picture added today; the simulator's samples are years old.
        let today = Date.now.formatted(.dateTime.month(.wide).day(.twoDigits))
        let picture = photos.descendants(matching: .any)
            .matching(NSPredicate(format: "label BEGINSWITH %@", "Photo, \(today)")).firstMatch
        XCTAssertTrue(picture.waitForExistence(timeout: 15), photos.debugDescription)
        picture.tap()
        let share = photos.buttons["Share"].firstMatch
        XCTAssertTrue(share.waitForExistence(timeout: 10), photos.debugDescription)
        share.tap()

        // iOS lists the app ("Cookie"); its two share extensions are chosen from there.
        let hubCell = photos.cells["Cookie"].firstMatch
        XCTAssertTrue(hubCell.waitForExistence(timeout: 10), photos.debugDescription)
        hubCell.tap()
        let ask = photos.descendants(matching: .any).matching(NSPredicate(format: "label == 'Ask Cookie'")).firstMatch
        if ask.waitForExistence(timeout: 5) { ask.tap() }

        let summarize = photos.buttons["Summarize"]
        XCTAssertTrue(summarize.waitForExistence(timeout: 20), photos.debugDescription)
        XCTAssertTrue(photos.buttons["Add to calendar"].exists)
        summarize.tap()
        let answer = photos.staticTexts.matching(NSPredicate(format: "label CONTAINS 'You shared 1 picture.'")).firstMatch
        XCTAssertTrue(answer.waitForExistence(timeout: 30), photos.debugDescription)
        XCTAssertTrue(photos.staticTexts["From what you shared"].exists)
        photos.buttons["Done"].firstMatch.tap()
    }
}
