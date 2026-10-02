import Foundation
import Testing
@testable import HubKit

/// School, suggestions and settings helpers (intent 0004, plan N6).
@Suite struct SettingsTests {
    let client = testClient()

    @Test func suggestionsMarkWhatTheModelWasUnsureOf() async throws {
        let list = try await client.api.listSuggestions().ok.body.json
        let new = try #require(list.suggestions.first { $0.kind == .new })
        #expect(new.unsure == ["place"])
        #expect(new.kindLabel == "New event")
        let change = try #require(list.suggestions.first { $0.kind == .change })
        #expect(change.unsure.isEmpty)
        #expect(change.target != nil, "a change names the event it changes")
    }

    @Test func sourcesSayWhatTheyAre() async throws {
        let sources = try await client.api.listSources().ok.body.json.sources
        #expect(sources.contains { $0.kindLabel == "Veracross" && $0.enabled })
        #expect(SourceKinds.label("gmail") == "Coach emails")
        #expect(sources.allSatisfy { !$0.failing })
    }

    @Test func schoolDayHasPeriodsWithRoomsAndTeachers() async throws {
        let day = try #require(try await client.api.getSchoolDay().ok.body.json.schoolDay)
        #expect(day.periods.map(\.title) == ["Math", "English", "Science", "French"])
        #expect(day.periods.allSatisfy { $0.room != nil && $0.teachers != nil })
        // Every child's day, the primary person's first.
        let days = try await client.api.getSchoolDay().ok.body.json.schoolDays
        #expect(days.map(\.person.name) == ["Child"])
    }

    @Test func providersMatchTheWebsite() {
        #expect(Providers.all.map(\.id) == ["teamsnap", "spordle", "veracross", "tennis_tc", "commit_swim", "ical"])
        #expect(Providers.kindLabel("secret_url") == "Private calendar link")
    }
}
