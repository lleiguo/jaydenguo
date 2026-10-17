import Foundation
import Testing
@testable import HubKit

/// Every recorded response decodes through the generated client (intent
/// 0004, plan N2.2). Fixtures come from scripts/record-api-fixtures.ts.
@Suite struct DecodingTests {
    let client = testClient()

    @Test func everyFixtureIsCovered() {
        #expect(Set(Fixtures.all) == Set(DecodingTests.decoders.keys), "add a decoder for new fixtures")
    }

    @Test(arguments: DecodingTests.decoders.keys.sorted())
    func decodes(_ operationID: String) async throws {
        try await DecodingTests.decoders[operationID]!(client)
    }

    @Test func todayHasTheSeededWeek() async throws {
        let today = try await client.api.getToday().ok.body.json
        #expect(!today.people.isEmpty)
        #expect(today.homeTimeZone == "America/Toronto")
        #expect(today.waiting.suggestions >= 0)
    }

    typealias Decode = @Sendable (HubClient) async throws -> Void
    static let id = "00000000-0000-4000-8000-000000000000"
    static let decoders: [String: Decode] = [
        "getMe": { _ = try await $0.api.getMe().ok.body.json },
        "listSessions": { _ = try await $0.api.listSessions().ok.body.json },
        "getSettings": { _ = try await $0.api.getSettings().ok.body.json },
        "listPeople": { _ = try await $0.api.listPeople().ok.body.json },
        "getToday": { _ = try await $0.api.getToday().ok.body.json },
        "getSchoolDay": { _ = try await $0.api.getSchoolDay().ok.body.json },
        "listEvents": { _ = try await $0.api.listEvents(query: .init(from: .now, to: .now.addingTimeInterval(86_400))).ok.body.json },
        "listDeletedEvents": { _ = try await $0.api.listDeletedEvents().ok.body.json },
        "getEvent": { _ = try await $0.api.getEvent(path: .init(id: id)).ok.body.json },
        "getSeries": { _ = try await $0.api.getSeries(path: .init(id: id)).ok.body.json },
        "getChanges": { _ = try await $0.api.getChanges().ok.body.json },
        "listClashes": { _ = try await $0.api.listClashes().ok.body.json },
        "getCalendarCopy": { _ = try await $0.api.getCalendarCopy().ok.body.json },
        "listSources": { _ = try await $0.api.listSources().ok.body.json },
        "listCredentials": { _ = try await $0.api.listCredentials().ok.body.json },
        "getCosts": { _ = try await $0.api.getCosts().ok.body.json },
        "listAssistantTurns": { _ = try await $0.api.listAssistantTurns().ok.body.json },
        "getAssistantSettings": { _ = try await $0.api.getAssistantSettings().ok.body.json },
        "listAssistantMemories": { _ = try await $0.api.listAssistantMemories().ok.body.json },
        "askAssistant": { _ = try await $0.api.askAssistant(body: .json(.init(text: "Hi"))).ok.body.json },
        "undoAssistantActions": { _ = try await $0.api.undoAssistantActions(path: .init(turnId: "t1")).ok.body.json },
        "listSuggestions": { _ = try await $0.api.listSuggestions().ok.body.json },
        "listMeets": { _ = try await $0.api.listMeets().ok.body.json },
        "getMeet": { _ = try await $0.api.getMeet(path: .init(id: id)).ok.body.json },
        "getSwimEvent": { _ = try await $0.api.getSwimEvent(path: .init(key: "x")).ok.body.json },
        "listPersonalBests": { _ = try await $0.api.listPersonalBests().ok.body.json },
        "listSwimResults": { _ = try await $0.api.listSwimResults().ok.body.json },
        "getTennisOverview": { _ = try await $0.api.getTennisOverview().ok.body.json },
        "listTennisResults": { _ = try await $0.api.listTennisResults().ok.body.json },
        "getTournament": { _ = try await $0.api.getTournament(path: .init(id: id)).ok.body.json },
        "getTennisEntry": { _ = try await $0.api.getTennisEntry(path: .init(id: "e1")).ok.body.json },
        "getTennisPlayer": { _ = try await $0.api.getTennisPlayer(path: .init(key: "1")).ok.body.json },
        "getTennisAccuracy": { _ = try await $0.api.getTennisAccuracy().ok.body.json },
        "listVideoReviews": { _ = try await $0.api.listVideoReviews().ok.body.json },
        "getVideoReview": { _ = try await $0.api.getVideoReview(path: .init(id: id)).ok.body.json },
        "getDeviceSettings": { _ = try await $0.api.getDeviceSettings().ok.body.json },
        "getNotification": { _ = try await $0.api.getNotification(path: .init(id: id)).ok.body.json },
        "getVideoSettings": { _ = try await $0.api.getVideoSettings().ok.body.json },
    ]
}
