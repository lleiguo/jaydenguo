import XCTest

/// N5 (intent 0004, OFF-1, OFF-2): after one visit online, the app opens
/// with no connection, shows the cached Today and calendar with "Offline,
/// updated …", and refuses changes. "No connection" is a closed local port.
final class OfflineTests: XCTestCase {
    private var server: String { ProcessInfo.processInfo.environment["HUB_TEST_SERVER"] ?? "http://localhost:3200" }
    private let nowhere = "http://localhost:9"

    override func setUp() {
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

    private func launch(baseURL: String, token: String) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["-HubBaseURL", baseURL, "-HubUITestToken", token, "-HubNoLock"]
        app.launch()
        return app
    }

    func testCachedTodayAndCalendarOfflineAndChangesRefused() throws {
        let token = try devToken()

        // Online once: Today and the calendar fill the cache.
        var app = launch(baseURL: server, token: token)
        XCTAssertTrue(app.staticTexts["Clashes in the next 7 days"].waitForExistence(timeout: 20))
        app.tabBars.buttons["Calendar"].tap()
        XCTAssertTrue(app.collectionViews["agenda"].waitForExistence(timeout: 20))
        XCTAssertFalse(app.descendants(matching: .any)["offlineBanner"].exists)
        app.terminate()

        // Offline: the same screens from the cache, with the banner.
        app = launch(baseURL: nowhere, token: token)
        XCTAssertTrue(app.staticTexts["Clashes in the next 7 days"].waitForExistence(timeout: 20), "Today comes from the cache")
        let banner = app.descendants(matching: .any).matching(identifier: "offlineBanner").firstMatch
        XCTAssertTrue(banner.waitForExistence(timeout: 10))
        XCTAssertTrue(banner.label.hasPrefix("Offline, updated"))

        app.tabBars.buttons["Calendar"].tap()
        let agenda = app.collectionViews["agenda"]
        XCTAssertTrue(agenda.waitForExistence(timeout: 20), "the calendar comes from the cache")

        // OFF-2: a change is refused, not queued.
        let row = agenda.buttons.matching(NSPredicate(format: "label CONTAINS 'Soccer practice'")).firstMatch
        for _ in 0..<6 where !row.exists { agenda.swipeUp() }
        row.tap()
        let skip = app.buttons["Skip this one"]
        XCTAssertTrue(skip.waitForExistence(timeout: 10))
        for _ in 0..<4 where !skip.isHittable { app.swipeUp() }
        skip.tap()
        XCTAssertTrue(app.staticTexts["You're offline."].waitForExistence(timeout: 10))
    }
}
