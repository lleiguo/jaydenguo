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
        #expect(messages.last?.kind == .notice)
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
