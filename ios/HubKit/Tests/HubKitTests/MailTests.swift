import Foundation
import Testing
@testable import HubKit

/// Today's mail (intent 0025): grouping, the Today card, the spoken queue,
/// the day's audio and the routes.
@Suite struct MailTests {
    let client = testClient()

    private func view() async throws -> MailView {
        try await client.api.getMail().ok.body.json
    }

    @Test func groupsTodaysMailByTopicAndFoldsTheRest() async throws {
        let v = try await view()
        let today = try #require(v.days.first { $0.day == v.today })
        let groups = MailGroups.byTopic(today.items)
        #expect(groups.map(\.topic) == [.school, .soccer])
        #expect(groups.flatMap { $0.items.map(\.subject) } == ["Field trip form", "Extra practice next week"])
        #expect(MailGroups.others(today.items).map(\.subject) == ["Your receipt"])
    }

    @Test func theCardSaysHowMuchAndWhatsLeft() async throws {
        let v = try await view()
        #expect(MailGroups.showsCard(v))
        #expect(MailGroups.cardLine(v) == "2 emails, 2 to do")
    }

    @Test func peopleChipsHideMailForHiddenPeopleOnly() async throws {
        let v = try await view()
        let items = try #require(v.days.first?.items)
        // The seed's mail is for the family: it shows whoever is hidden.
        #expect(MailGroups.byTopic(items, hiddenPeople: ["someone"]).flatMap(\.items).count == 2)
    }

    @Test func linkedSuggestionComesWithTheEmail() async throws {
        let v = try await view()
        let practice = try #require(v.days.first?.items.first { $0.subject == "Extra practice next week" })
        #expect(practice.suggestion?.status == "pending")
        #expect(practice.suggestion?.title == "Extra soccer practice")
    }

    @Test func theQueueStepsThroughTheParts() async throws {
        let script = try await client.api.getMailScript().ok.body.json
        #expect(script.parts.first?.id == "intro")
        #expect(script.parts.last?.id == "todos")
        var queue = MailQueue(parts: script.parts)
        #expect(queue.current?.id == "intro")
        #expect(!queue.hasPrevious)
        var steps = 0
        while queue.next() { steps += 1 }
        #expect(steps == script.parts.count - 1)
        #expect(queue.current?.id == "todos")
        queue.previous()
        #expect(queue.current?.id == script.parts[script.parts.count - 2].id)
        #expect(MailQueue(parts: []).current == nil)
    }

    @Test func keepsOnlyTheDaysAudio() throws {
        let folder = FileManager.default.temporaryDirectory.appendingPathComponent("mail-audio-\(UUID().uuidString)")
        let cache = MailAudioCache(folder: folder)
        defer { cache.wipe() }
        cache.write(Data([1, 2, 3]), day: "2026-10-24", part: "intro")
        cache.write(Data([4]), day: "2026-10-25", part: "intro")
        #expect(cache.read(day: "2026-10-25", part: "intro") == Data([4]))
        cache.keepOnly("2026-10-25")
        #expect(cache.read(day: "2026-10-24", part: "intro") == nil)
        #expect(cache.read(day: "2026-10-25", part: "intro") == Data([4]))
    }

    @Test func theMorningNotificationOpensMail() {
        #expect(Route(url: URL(string: "jaydenguohub://open/mail")!) == .mail)
        #expect(Push.route(target: "mail", kind: "mail") == .mail)
        #expect(Route.mail.tab == .today)
    }
}
