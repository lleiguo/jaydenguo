import Foundation
import HubAPI
import Testing
@testable import HubKit

/// Cookie's chat rules (intent 0007, plan K2.1).
@Suite struct AssistantTests {
    let client = testClient()

    @Test func historyBecomesBubblesOldestFirst() async throws {
        let turns = try await client.api.listAssistantTurns().ok.body.json.turns
        let messages = CookieChat.messages(turns)
        #expect(messages.count == turns.count * 2)
        #expect(messages.map(\.role).prefix(2) == [.you, .cookie])
        #expect(messages[0].text == "What's on today?")
        #expect(messages[1].sourceLine == "From Today")
        #expect(messages[3].sourceLine == "From earlier in this chat")
        #expect(Set(messages.map(\.id)).count == messages.count)
    }

    @Test func aBarkAndALimitAreNotAnswers() async throws {
        let messages = CookieChat.messages(try await client.api.listAssistantTurns().ok.body.json.turns)
        let bark = try #require(messages.first { $0.text.hasPrefix("汪") })
        #expect(bark.kind == .bark)
        #expect(bark.sourceLine == nil)
        #expect(bark.spokenLabel == "Cookie barked: 汪！这个我不知道。")
        #expect(messages.first { $0.text.hasPrefix("Cookie needs a rest") }?.kind == .notice)
    }

    @Test func anAnswerFromHerselfNamesNoSource() async throws {
        let answer = try await client.api.askAssistant(body: .json(.init(text: "Hi Cookie"))).ok.body.json
        let message = CookieChat.message(answer)
        #expect(message.id == answer.turnId)
        #expect(message.kind == .answer)
        #expect(message.sourceLine == nil)
        #expect(message.spokenLabel == "Cookie: Woof! I'm Cookie.")
    }

    @Test func aSavedFactCanBeUndoneFromTheAnswer() throws {
        let fact = CookieMemory(
            id: "m1", text: "The spare key is under the blue pot", about: [], via: .chat,
            savedBy: "pat@example.test", createdAt: "2026-10-02T15:00:00.000Z"
        )
        let source = CookieSource(kind: .memory, label: "Memory")
        let saved = CookieChat.message(.init(
            turnId: "t1", conversationId: "c1", heard: "Remember the spare key is under the blue pot", language: .en,
            outcome: .answer, text: "Saved: the spare key is under the blue pot.", sources: [source], saved: fact
        ))
        #expect(saved.memory == .init(kind: .saved, id: "m1", text: fact.text))
        #expect(saved.memory?.label == "Saved to memory")
        #expect(saved.sourceLine == "From Memory")
        let forgot = CookieChat.message(.init(
            turnId: "t2", conversationId: "c1", heard: "Forget the spare key", language: .en,
            outcome: .answer, text: "Forgotten.", sources: [source], forgot: fact
        ))
        #expect(forgot.memory?.kind == .forgot)
        #expect(forgot.memory?.label == "Forgotten")
    }

    @Test func theMemoryListSaysWhoSavedEachFactAndWhen() async throws {
        let memories = try await client.api.listAssistantMemories().ok.body.json.memories
        #expect(memories.count == 2)
        let time = HomeTime(identifier: "America/Toronto")
        #expect(memories[0].savedLine(time).hasPrefix("Saved by owner · "))
        #expect(!memories[0].savedLine(time).contains("@"))
        #expect(CookieChat.fact("  Locker 12  ") == "Locker 12")
        #expect(CookieChat.fact("") == nil)
        #expect(CookieChat.fact(String(repeating: "a", count: 301)) == nil)
    }

    @Test func webSourcesBecomeLinksOnlyWhenHTTPS() {
        let sources: [CookieSource] = [
            .init(kind: .web, label: "Pool hours", url: "https://pool.example/hours"),
            .init(kind: .web, label: "Old page", url: "http://pool.example/old"),
            .init(kind: .hub, label: "Calendar", url: "https://not-a-web-source.example"),
        ]
        #expect(CookieChat.links(sources).map(\.label) == ["Pool hours"])
        #expect(CookieChat.sourceLine(sources) == "From the web: Pool hours, the web: Old page, Calendar")
    }

    @Test func aFollowUpContinuesARecentConversationOnly() async throws {
        let turns = try await client.api.listAssistantTurns().ok.body.json.turns
        let last = try #require(HomeTime.parse(turns.last!.createdAt))
        #expect(CookieChat.conversation(after: turns, now: last.addingTimeInterval(60)) == turns.last?.conversationId)
        #expect(CookieChat.conversation(after: turns, now: last.addingTimeInterval(31 * 60)) == nil)
        #expect(CookieChat.conversation(after: [], now: .now) == nil)
    }

    @Test func questionsAreTrimmedAndCapped() {
        #expect(CookieChat.question("  When is swim?  ") == "When is swim?")
        #expect(CookieChat.question("   ") == nil)
        #expect(CookieChat.question(String(repeating: "a", count: 500)) != nil)
        #expect(CookieChat.question(String(repeating: "a", count: 501)) == nil)
    }

    // MARK: Changes to the calendar (intent 0008, plan E3.1)

    @Test func anAddedEventIsACardUnderTheAnswer() async throws {
        let turns = try await client.api.listAssistantTurns().ok.body.json.turns
        let messages = CookieChat.messages(turns)
        #expect(messages.filter { $0.changes != nil }.count == 1)
        let answer = try #require(messages.last)
        let changes = try #require(answer.changes)
        #expect(changes.turnId == answer.id)
        let card = try #require(changes.cards.first)
        let time = HomeTime(identifier: "America/Toronto", locale: Locale(identifier: "en_US"))
        // 23:00 UTC on 3 December is 6 pm at home.
        #expect(card.whenLine(time).hasPrefix("Thursday, December 3 · 6:00"))
        #expect(card.whoLine == "For Sam")
        #expect(card.state == .adding)
        #expect(card.stateLine == "Being added to the family calendar…")
        #expect(card.opens)
        #expect(card.spokenLabel(time).hasPrefix("dentist appointment. Thursday, December 3"))
        #expect(changes.isSettling)
    }

    @Test func undoIsOfferedForTenMinutesOnly() async throws {
        let turns = try await client.api.listAssistantTurns().ok.body.json.turns
        let changes = try #require(CookieChat.messages(turns).last?.changes)
        let until = try #require(HomeTime.parse("2026-10-02T16:00:00.000Z"))
        #expect(changes.canUndo(now: until.addingTimeInterval(-1)))
        #expect(!changes.canUndo(now: until))
    }

    @Test func anAllDayEventKeepsItsDate() {
        let did = CookieDid(kind: .calendar, undoUntil: nil, events: [
            .init(
                id: "e1", title: "Field trip", start: "2026-12-04T00:00:00.000Z", end: "2026-12-05T00:00:00.000Z",
                allDay: true, owners: ["Sam", "Alex"], state: .added, change: .added, via: .cookie
            ),
        ])
        let changes = CookieChanges(turnId: "t1", did: did)
        let card = changes.cards[0]
        let time = HomeTime(identifier: "America/Toronto", locale: Locale(identifier: "en_US"))
        #expect(card.whenLine(time) == "Friday, December 4 · All day")
        #expect(card.whoLine == "For Sam and Alex")
        #expect(!changes.canUndo())
        #expect(!changes.isSettling)
    }

    @Test func aFailedOrUndoneEventDoesNotOpen() {
        let did = CookieDid(kind: .calendar, undoUntil: nil, events: [
            .init(id: nil, title: "Dentist", start: "2026-12-04T02:00:00.000Z", end: "2026-12-04T03:00:00.000Z",
                  allDay: false, owners: [], state: .failed, change: .added, via: .cookie),
            .init(id: "e2", title: "Dentist", start: "2026-12-04T02:00:00.000Z", end: "2026-12-04T03:00:00.000Z",
                  allDay: false, owners: [], state: .undone, change: .added, via: .cookie),
        ])
        let cards = CookieChanges(turnId: "t1", did: did).cards
        #expect(cards.map(\.opens) == [false, false])
        #expect(cards[0].stateLine == "Couldn't be added to the family calendar")
        #expect(cards[0].whoLine == nil)
        #expect(Set(cards.map(\.id)).count == 2)
    }

    @Test func anAppliedEmailSuggestionSaysWhatItDid() {
        let did = CookieDid(kind: .calendar, undoUntil: "2026-10-02T16:00:00.000Z", events: [
            .init(id: "e1", title: "Extra practice", start: "2026-12-09T23:00:00.000Z", end: "2026-12-10T00:30:00.000Z",
                  allDay: false, owners: ["Sam"], state: .added, change: .added, via: .email),
            .init(id: "e2", title: "Game", start: "2026-12-12T18:00:00.000Z", end: "2026-12-12T19:30:00.000Z",
                  allDay: false, owners: ["Sam"], state: .added, change: .moved, via: .email),
            .init(id: "e3", title: "Practice", start: "2026-12-08T23:00:00.000Z", end: "2026-12-09T00:30:00.000Z",
                  allDay: false, owners: ["Sam"], state: .added, change: .cancelled, via: .email),
        ])
        let cards = CookieChanges(turnId: "t1", did: did).cards
        #expect(cards.map(\.stateLine) == ["Added from email", "Moved, as the email said", "Cancelled, as the email said"])
        #expect(cards.allSatisfy { $0.fromEmail })
        #expect(cards.allSatisfy { $0.opens })
        #expect(!CookieChanges(turnId: "t1", did: did).isSettling)
    }

    @Test func undoReturnsWhatTheAnswerDidAfterwards() async throws {
        let transport = FixtureTransport()
        let changes = try await testClient(transport: transport).undoCookieChanges(turnId: "t1")
        #expect(transport.requests.first?.operationID == "undoAssistantActions")
        #expect(transport.requests.first?.request.path == "/api/v1/assistant/actions/t1/undo")
        #expect(changes.cards.map(\.state) == [.undone])
        #expect(!changes.canUndo())
    }

    @Test func freshTurnsUpdateOnlyTheCards() async throws {
        let turns = try await client.api.listAssistantTurns().ok.body.json.turns
        let messages = CookieChat.messages(turns)
        var later = turns
        let last = later.removeLast()
        var did = try #require(last.did)
        did.events[0].state = .added
        later.append(.init(
            id: last.id, conversationId: last.conversationId, mode: last.mode, heard: last.heard, text: last.text,
            outcome: last.outcome, language: last.language, sources: last.sources, did: did, createdAt: last.createdAt
        ))
        let refreshed = CookieChat.refreshed(messages, from: later)
        #expect(refreshed.last?.changes?.cards.first?.state == .added)
        #expect(refreshed.last?.text == messages.last?.text)
        #expect(Array(refreshed.dropLast()) == Array(messages.dropLast()))
    }

    /// CSEC-8: nothing from Cookie is kept on the phone, so offline there
    /// is no old chat to show.
    @Test func theChatIsNeverCached() async throws {
        let transport = FixtureTransport()
        let cache = temporaryCache()
        let client = testClient(transport: transport, cache: cache)
        _ = try await client.api.listAssistantTurns().ok
        _ = try await client.api.getAssistantSettings().ok
        transport.failure = URLError(.notConnectedToInternet)
        await #expect(throws: (any Error).self) { _ = try await client.api.listAssistantTurns().ok }
        await #expect(throws: (any Error).self) { _ = try await client.api.getAssistantSettings().ok }
    }
}
