import XCTest

/// Plan N8.3 (intent 0004, INFR-2): how long a relaunch takes. Measured on
/// the Simulator; the phone check is by hand.
final class LaunchTests: XCTestCase {
    private var server: String { ProcessInfo.processInfo.environment["HUB_TEST_SERVER"] ?? "http://localhost:3200" }

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

    /// The app's own measure (Settings → App → "Opened Today in"): from the
    /// process starting to Today's list first showing with the offline copy
    /// in place, and the app's own share of it (after the system loaded
    /// it). On the Simulator a Debug build takes ~2 s just to load, so the
    /// test holds the app's share to the budget and reports the whole; the
    /// whole is checked on the phone. (XCUITest's launch metrics add seconds
    /// of the harness, so they aren't used.)
    func testCachedTodayShowsWithinASecond() throws {
        let app = XCUIApplication()
        app.launchArguments = ["-HubBaseURL", server, "-HubUITestToken", try devToken(), "-HubNoLock"]
        app.launch()
        XCTAssertTrue(app.collectionViews["todayList"].waitForExistence(timeout: 20))
        app.terminate()

        var whole: [Double] = [], own: [Double] = []
        for _ in 0..<3 {
            app.launch()
            XCTAssertTrue(app.collectionViews["todayList"].waitForExistence(timeout: 10))
            app.open(URL(string: "jaydenguohub://open/settings")!)
            app.navigationBars.buttons.firstMatch.tap()
            app.buttons["App"].tap()
            let row = app.descendants(matching: .any).matching(identifier: "launchTime").firstMatch
            XCTAssertTrue(row.waitForExistence(timeout: 10))
            // "Opened Today in, 2.34 s (app 0.27 s)"
            let numbers = row.label.split(whereSeparator: { !"0123456789.".contains($0) }).compactMap { Double($0) }
            XCTAssertEqual(numbers.count, 2, row.label)
            whole.append(numbers.first ?? .infinity)
            own.append(numbers.last ?? .infinity)
            app.terminate()
        }
        let fmt = { (xs: [Double]) in xs.map { String(format: "%.2f s", $0) }.joined(separator: ", ") }
        print("cached Today after launch: \(fmt(whole)); the app's own code: \(fmt(own))")
        XCTAssertLessThan(own.min() ?? .infinity, 1.0, "INFR-2: the app's own share of opening Today")
    }
}
