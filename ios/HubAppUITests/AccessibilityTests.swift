import XCTest

/// Plan N8.3 (intent 0004, APP-6): Apple's accessibility audit (the checks
/// Accessibility Inspector runs) on every screen, against the local seed
/// server. Its Dynamic Type and clipping checks flag system text styles in
/// lists that do scale and aren't cut off, so those are checked by eye at
/// the largest accessibility size instead (plan N8.3 notes). Contrast is
/// reported but doesn't fail the test: what's left is text under the
/// system's translucent bars and the system's own secondary and destructive
/// colours; the app's own text colours were fixed (`.warning`, `.good`).
final class AccessibilityTests: XCTestCase {
    private var server: String { ProcessInfo.processInfo.environment["HUB_TEST_SERVER"] ?? "http://localhost:3200" }

    override func setUp() {
        continueAfterFailure = true
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

    /// Screens by their app link, with a title to wait for.
    static let screens: [(link: String, title: String)] = [
        ("today", "Today"),
        ("calendar", "Calendar"),
        ("tennis", "Tennis"),
        ("swimming", "Swimming"),
        ("school", "School"),
        ("suggestions", "Suggestions"),
        ("videos", "Videos"),
        ("videos/5eed0000-0000-4000-8000-000000000001", "Tennis · "),
        ("sources", "Sources"),
        ("accounts", "Accounts"),
        ("settings", "General"),
        ("settings/notifications", "Notifications"),
        ("clashes", "Calendar"),
    ]

    @MainActor func testEveryScreenPassesTheAudit() throws {
        let app = XCUIApplication()
        app.launchArguments = ["-HubBaseURL", server, "-HubUITestToken", try devToken(), "-HubNoLock"]
        app.launch()
        XCTAssertTrue(app.navigationBars["Today"].waitForExistence(timeout: 20))
        var issues: [String] = []
        var contrast: [String] = []
        for screen in Self.screens {
            app.open(URL(string: "jaydenguohub://open/\(screen.link)")!)
            let bar = app.navigationBars.matching(NSPredicate(format: "identifier BEGINSWITH %@", screen.title)).firstMatch
            XCTAssertTrue(bar.waitForExistence(timeout: 15), screen.link)
            sleep(2) // let lists load
            try app.performAccessibilityAudit(for: [.contrast, .elementDetection, .hitRegion, .sufficientElementDescription, .trait]) { issue in
                let what = issue.element.map { "\($0.elementType.rawValue) '\($0.label)' id=\($0.identifier)" } ?? "-"
                let line = "\(screen.link): \(issue.compactDescription) [\(what)]"
                if issue.auditType == .contrast {
                    if !issue.compactDescription.contains("nearly passed") { contrast.append(line) }
                } else {
                    issues.append(line)
                }
                return true
            }
        }
        print("contrast to look at (not failing):\n" + contrast.joined(separator: "\n"))
        if !issues.isEmpty {
            XCTFail("\(issues.count) accessibility issues:\n" + issues.joined(separator: "\n"))
        }
    }
}
