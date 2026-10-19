import Foundation
import Testing
@testable import HubKit

/// Notifications (intent 0004, PUSH-2..4): what the extension and the app
/// do with a push that carries only an id.
@Suite struct PushTests {
    let client = testClient()

    @Test func tokensGoAsLowercaseHex() {
        #expect(Push.hex(Data([0x0a, 0xff, 0x00, 0x7b])) == "0aff007b")
    }

    @Test func thePushCarriesOnlyTheId() {
        let info: [AnyHashable: Any] = ["aps": ["alert": ["title": "Hub", "body": "New update"]], "id": "abc", "kind": "video"]
        #expect(Push.id(from: info) == "abc")
        #expect(Push.id(from: ["aps": [:]]) == nil)
    }

    @Test func theTextAndWhereATapGoes() async throws {
        let text = try #require(await Push.text(id: "5eed0000-0000-4000-8000-000000000101", client: client))
        #expect(text.title == "Video review ready")
        #expect(text.kind == .video)
        #expect(Push.route(target: text.target) == .video(id: "5eed0000-0000-4000-8000-000000000001"))
        #expect(Push.route(target: "events/e1") == .event(id: "e1"))
        #expect(Push.route(target: "sources") == .sources)
        #expect(Push.route(target: "settings/notifications") == .notifications)
    }

    @Test func settingsListEveryKindWithSuggestionsOffByDefault() async throws {
        let s = try await client.api.getDeviceSettings().ok.body.json
        #expect(s.available.count == 7)
        #expect(!s.kinds.contains(.suggestion))
        #expect(s.kinds.contains(.clash))
        // Intent 0023: kinds older builds can't read come apart.
        #expect(s.more.map(\.kind) == [.cookie, .tennisResult, .swim])
    }
}
