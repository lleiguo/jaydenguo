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

    // Intent 0020, TWO-9: the switch and a dry run's list, as on the website.
    @Test func householdSyncShowsTheDryRunList() async throws {
        let sync = try await client.api.getHouseholdSync().ok.body.json
        #expect(HouseholdMode.ordered.map(\.label) == ["Off", "Dry run", "On"])
        #expect(sync.mode == .dryRun)
        #expect(sync.chosenSource?.name == "Household", "the only calendar is the one it writes to")
        let plan = try #require(sync.dryRun?.plan)
        #expect(plan.sections.map(\.heading) == ["Add", "Match to an event already there"])
        #expect(HouseholdPlan.count(plan.create) == "2")
        let home = HomeTime(identifier: "America/Toronto", locale: Locale(identifier: "en_US"))
        // 21:00 UTC is 5 PM in Toronto, whatever zone the phone is in.
        let when = home.dayAndTime(plan.create[0].start)
        #expect(when.hasPrefix("Monday, October 19, 5:00") && when.hasSuffix("PM"))
        #expect(sync.lastSummary == "0 added, 0 changed, 0 matched, 0 deleted, 0 from Google")
    }

    // BACK-3: a move read back from Google says so on the event screen.
    @Test func overrideKnowsAGoogleMove() throws {
        let json = #"{"id":"o1","skip":false,"attendance":null,"moved":true,"originalStart":"2026-10-19T21:00:00.000Z","originalEnd":"2026-10-19T22:00:00.000Z","sourceChangedAt":null,"createdBy":"Google Calendar","createdAt":"2026-10-17T19:00:00.000Z"}"#
        var o = try JSONDecoder().decode(CalendarEvent.OverridePayload.self, from: Data(json.utf8))
        #expect(o.changedInGoogle)
        o.createdBy = "owner@example.test"
        #expect(!o.changedInGoogle)
    }
}
