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

    /// Intent 0018 (SAV-1..3): with a server that takes the connection and
    /// never answers, the saved calendar is on screen at once (no spinner),
    /// and the banner owns up after about 8 s.
    func testSlowServerShowsTheSavedCalendarFirst() throws {
        let token = try devToken()
        var app = launch(baseURL: server, token: token)
        app.tabBars.buttons["Calendar"].tap()
        XCTAssertTrue(app.collectionViews["agenda"].waitForExistence(timeout: 20))
        app.terminate()

        let silent = try SilentServer()
        defer { silent.close() }
        app = launch(baseURL: "http://localhost:\(silent.port)", token: token)
        app.tabBars.buttons["Calendar"].tap()
        XCTAssertTrue(app.collectionViews["agenda"].waitForExistence(timeout: 3), "the saved calendar, without waiting")
        let banner = app.descendants(matching: .any).matching(identifier: "offlineBanner").firstMatch
        XCTAssertTrue(banner.waitForExistence(timeout: 15))
        XCTAssertTrue(banner.label.hasPrefix("Offline, updated"))
    }
}

/// A port that accepts connections and never answers: a slow network.
private final class SilentServer {
    private let fd: Int32
    let port: UInt16

    init() throws {
        let fd = socket(AF_INET, SOCK_STREAM, 0)
        var addr = sockaddr_in()
        addr.sin_family = sa_family_t(AF_INET)
        addr.sin_addr.s_addr = inet_addr("127.0.0.1")
        addr.sin_port = 0
        var len = socklen_t(MemoryLayout<sockaddr_in>.size)
        let bound = withUnsafeMutablePointer(to: &addr) {
            $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { bind(fd, $0, len) == 0 && getsockname(fd, $0, &len) == 0 }
        }
        guard bound, listen(fd, 64) == 0 else { throw POSIXError(.EADDRNOTAVAIL) }
        self.fd = fd
        port = UInt16(bigEndian: addr.sin_port)
    }

    func close() { Darwin.close(fd) }
}
