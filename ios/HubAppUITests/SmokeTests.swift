import XCTest

/// N2 smoke tests (intent 0004, plan N2.3, N2.4) against the local
/// development server with seed data (HUB_TEST_SERVER, see ios/README.md).
final class SmokeTests: XCTestCase {
    private var server: String { ProcessInfo.processInfo.environment["HUB_TEST_SERVER"] ?? "http://localhost:3200" }

    override func setUp() {
        continueAfterFailure = false
    }

    /// A device token from the server's development-only route.
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

    private func launchSignedIn() throws -> XCUIApplication {
        let app = XCUIApplication()
        app.launchArguments = ["-HubBaseURL", server, "-HubUITestToken", try devToken(), "-HubNoLock"]
        app.launch()
        return app
    }

    func testTodayShowsTheSeededDay() throws {
        let app = try launchSignedIn()
        XCTAssertTrue(app.navigationBars["Today"].waitForExistence(timeout: 20))
        XCTAssertTrue(app.collectionViews["todayList"].waitForExistence(timeout: 20))
    }

    func testEveryTabOpens() throws {
        let app = try launchSignedIn()
        for tab in ["Calendar", "Tennis", "Swimming", "More", "Today"] {
            app.tabBars.buttons[tab].tap()
            XCTAssertTrue(app.navigationBars[tab].waitForExistence(timeout: 10), tab)
        }
    }

    func testSignOutReturnsToSignIn() throws {
        let app = try launchSignedIn()
        app.tabBars.buttons["More"].tap()
        app.buttons["App"].tap()
        XCTAssertTrue(app.staticTexts["owner@example.test"].waitForExistence(timeout: 10) || app.staticTexts["Signed in as"].exists)
        app.buttons["signOut"].tap()
        app.sheets.buttons["Sign out"].firstMatch.tap()
        XCTAssertTrue(app.buttons["Sign in with Google"].waitForExistence(timeout: 10))

        // Relaunching without a token stays signed out: nothing was left behind.
        app.terminate()
        let again = XCUIApplication()
        again.launchArguments = ["-HubBaseURL", server, "-HubNoLock"]
        again.launch()
        XCTAssertTrue(again.buttons["Sign in with Google"].waitForExistence(timeout: 10))
    }
}
