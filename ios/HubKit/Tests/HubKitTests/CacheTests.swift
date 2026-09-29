import Foundation
import Testing
@testable import HubKit

/// The offline cache (intent 0004, OFF-1..3) and what the widgets read
/// (EXT-1, EXT-2).
@Suite struct CacheTests {
    @Test func servesTheLastAnswerOffline() async throws {
        let transport = FixtureTransport()
        let cache = temporaryCache()
        let events = EventLog()
        let client = testClient(transport: transport, cache: cache, events: events)
        let online = try await client.api.getToday().ok.body.json

        transport.failure = URLError(.notConnectedToInternet)
        let offline = try await client.api.getToday().ok.body.json
        #expect(offline.date == online.date)
        #expect(events.all.contains(.online))
        guard case .offline(let since) = events.all.last else {
            Issue.record("expected an offline event")
            return
        }
        #expect(abs(since.timeIntervalSinceNow) < 60)
    }

    @Test func writesAndUncachedReadsFailOffline() async throws {
        let transport = FixtureTransport()
        transport.failure = URLError(.networkConnectionLost)
        let client = testClient(transport: transport, cache: temporaryCache())
        do {
            _ = try await client.api.skipEvent(path: .init(id: "e1"), body: .json(.init(skip: true))).ok
            Issue.record("a write can't succeed offline")
        } catch {
            #expect(HubError.from(error) == .offline)
            #expect(HubError.from(error)?.message == "You're offline.")
        }
        await #expect(throws: (any Error).self) { _ = try await client.api.getMe().ok }
    }

    @Test func theChangeFeedIsNeverReplayed() async throws {
        let transport = FixtureTransport()
        let client = testClient(transport: transport, cache: temporaryCache())
        _ = try await client.api.getChanges().ok
        transport.failure = URLError(.notConnectedToInternet)
        await #expect(throws: (any Error).self) { _ = try await client.api.getChanges().ok }
    }

    @Test func differentQueriesAreKeptApart() {
        #expect(ResponseCache.key(path: "/api/v1/events?from=a") != ResponseCache.key(path: "/api/v1/events?from=b"))
        #expect(ResponseCache.key(path: "/x").count == 32)
    }

    @Test func signingOutWipesIt() async throws {
        let cache = temporaryCache()
        let client = testClient(cache: cache)
        _ = try await client.api.getToday().ok
        try WidgetSnapshot(timeZone: "UTC", items: []).save(to: cache)
        #expect(FileManager.default.fileExists(atPath: cache.directory.path))
        client.forgetToken()
        #expect(!FileManager.default.fileExists(atPath: cache.directory.path))
        #expect(WidgetSnapshot.load(from: cache) == nil)
    }

    @Test func keepsTheNewestAndTheWidgetFile() throws {
        let cache = temporaryCache(limit: 3)
        try WidgetSnapshot(timeZone: "UTC", items: []).save(to: cache)
        for i in 0..<5 { cache.store(Data("\(i)".utf8), key: "k\(i)", at: .now.addingTimeInterval(Double(i))) }
        #expect(cache.load(key: "k4") != nil)
        #expect(cache.load(key: "k0") == nil)
        #expect(WidgetSnapshot.load(from: cache) != nil)
    }

    @Test func isOutOfBackups() throws {
        let cache = temporaryCache()
        cache.store(Data("{}".utf8), key: "k")
        let values = try cache.directory.resourceValues(forKeys: [.isExcludedFromBackupKey])
        #expect(values.isExcludedFromBackup == true)
    }
}

@Suite struct WidgetSnapshotTests {
    // 2026-10-01 in Toronto (UTC−4).
    let now = HomeTime.parse("2026-10-01T15:00:00.000Z")!
    func at(_ iso: String) -> Date { HomeTime.parse(iso)! }

    var snapshot: WidgetSnapshot {
        WidgetSnapshot(timeZone: "America/Toronto", items: [
            .init(title: "Swim squad", symbol: "figure.pool.swim", category: "swimming",
                  start: at("2026-10-01T21:30:00.000Z"), end: at("2026-10-01T23:00:00.000Z"), allDay: false, clash: true, place: nil),
            .init(title: "School", symbol: "graduationcap.fill", category: "school_class",
                  start: at("2026-10-01T12:30:00.000Z"), end: at("2026-10-01T19:10:00.000Z"), allDay: false, clash: false, place: nil),
            .init(title: "Tennis lesson", symbol: "tennisball.fill", category: "tennis",
                  start: at("2026-10-02T21:00:00.000Z"), end: at("2026-10-02T22:00:00.000Z"), allDay: false, clash: false, place: nil),
            .init(title: "Field trip", symbol: "circle.fill", category: "other",
                  start: at("2026-10-01T00:00:00.000Z"), end: at("2026-10-02T00:00:00.000Z"), allDay: true, clash: false, place: nil),
            .init(title: "Soccer practice", symbol: "soccerball", category: "soccer",
                  start: at("2026-10-01T13:00:00.000Z"), end: at("2026-10-01T14:00:00.000Z"), allDay: false, clash: false, place: nil),
        ])
    }

    @Test func nextUpSkipsWhatHasEnded() {
        let next = snapshot.upcoming(at: now).map(\.title)
        #expect(next == ["School", "Swim squad", "Tennis lesson"])
        #expect(snapshot.inlineText(at: now) == "Next: School now")
        #expect(snapshot.inlineText(at: at("2026-10-01T20:00:00.000Z")) == "Next: Swim squad 17:30")
    }

    @Test func todayUsesTheHomeDate() {
        #expect(snapshot.today(at: now).map(\.title) == ["Field trip", "School", "Swim squad"])
    }

    @Test func redrawsAtEachEndAndAtMidnight() {
        let dates = snapshot.timelineDates(from: now)
        #expect(dates.first == now)
        #expect(dates.contains(at("2026-10-01T19:10:00.000Z")))
        #expect(dates.contains(at("2026-10-02T04:00:00.000Z")), "midnight in Toronto")
        #expect(dates == dates.sorted())
    }

    @Test func roundTripsThroughTheCache() throws {
        let cache = temporaryCache()
        let saved = snapshot
        try saved.save(to: cache)
        #expect(WidgetSnapshot.load(from: cache) == saved)
    }
}

@Suite struct WidgetBuildTests {
    let client = testClient()

    @Test func buildsFromTheSeededCalendar() async throws {
        let payload = try await client.api.listEvents(query: .init(from: .now, to: .now)).ok.body.json
        let index = CalendarIndex(payload)
        let home = HomeTime(identifier: payload.homeTimeZone)
        // The fixture's first day with events.
        let first = try #require(payload.events.compactMap(\.startDate).min())
        let snapshot = WidgetSnapshot.build(from: index, filters: CalendarFilters(), homeTime: home, now: first, days: 7)
        #expect(!snapshot.items.isEmpty)
        #expect(snapshot.items.filter { $0.category == "school_class" && $0.title != "School" }.isEmpty,
                "school days fold into one item")
        #expect(snapshot.items.contains { $0.clash }, "the seed has clashes")

        // Hiding every person hides their events from the widgets too.
        var hidden = CalendarFilters()
        hidden.hiddenPeople = Set(payload.people.map(\.id))
        let none = WidgetSnapshot.build(from: index, filters: hidden, homeTime: home, now: first, days: 7)
        #expect(none.items.count < snapshot.items.count)
    }
}
