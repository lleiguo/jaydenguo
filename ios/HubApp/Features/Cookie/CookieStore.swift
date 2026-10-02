import Foundation
import HubAPI
import HubKit
import Observation

/// The chat with Cookie (intent 0007, CK-4). Nothing is kept on the phone:
/// history comes from the server each time the app starts (CSEC-8), and
/// signing out forgets what's in memory.
@MainActor @Observable
final class CookieStore {
    private(set) var messages: [CookieMessage] = []
    private(set) var isAsking = false
    private(set) var isLoading = false
    /// Why history couldn't be loaded, in words to show.
    private(set) var loadError: String?
    var draft = ""

    private let client: HubClient
    private var loaded = false
    private var conversationId: String?
    private var lastAskedAt: Date?

    init(client: HubClient) {
        self.client = client
    }

    var canSend: Bool { !isAsking && CookieChat.question(draft) != nil }

    /// The last turns, once per app start.
    func loadIfNeeded() async {
        guard !loaded, !isLoading else { return }
        isLoading = true
        defer { isLoading = false }
        do {
            let turns = try await client.api.listAssistantTurns(query: .init(limit: 30)).ok.body.json.turns
            // Anything asked while this was loading stays at the end.
            messages = CookieChat.messages(turns) + messages
            if conversationId == nil { conversationId = CookieChat.conversation(after: turns) }
            if lastAskedAt == nil { lastAskedAt = turns.last.flatMap { HomeTime.parse($0.createdAt) } }
            loaded = true
            loadError = nil
        } catch {
            loadError = HubError.from(error)?.message ?? "Couldn't load the chat."
        }
    }

    func send() async {
        guard !isAsking, let text = CookieChat.question(draft) else { return }
        draft = ""
        isAsking = true
        defer { isAsking = false }
        messages.append(CookieMessage(id: UUID().uuidString, role: .you, text: text))
        // A follow-up continues the conversation; after a pause it's a new one (MEM-8).
        if let last = lastAskedAt, Date.now.timeIntervalSince(last) >= CookieChat.followUpWindow { conversationId = nil }
        do {
            let answer = try await client.api
                .askAssistant(body: .json(.init(conversationId: conversationId, text: text))).ok.body.json
            conversationId = answer.conversationId
            lastAskedAt = .now
            messages.append(CookieChat.message(answer))
        } catch {
            let why = HubError.from(error)?.message ?? "Cookie couldn't be reached. Try again."
            messages.append(CookieMessage(id: UUID().uuidString, role: .cookie, text: why, kind: .notice))
        }
    }

    /// "Undo" under an answer that saved or forgot a fact (MEM-2): forgets
    /// what was saved, or brings back what was forgotten.
    func undo(_ message: CookieMessage) async -> String? {
        guard let change = message.memory, let index = messages.firstIndex(where: { $0.id == message.id }) else { return nil }
        do {
            switch change.kind {
            case .saved: _ = try await client.api.forgetAssistantMemory(path: .init(id: change.id)).ok
            case .forgot: _ = try await client.api.restoreAssistantMemory(path: .init(id: change.id)).ok
            }
        } catch {
            return HubError.from(error)?.message ?? "Couldn't undo that."
        }
        // The answer stays; the Undo goes.
        messages[index] = CookieMessage(
            id: message.id, role: message.role, text: message.text, kind: message.kind,
            sourceLine: message.sourceLine, links: message.links
        )
        return change.kind == .saved ? "Not saved after all." : "Restored."
    }

    /// After "Clear history", and on sign-out (SEC-3).
    func reset() {
        messages = []
        conversationId = nil
        lastAskedAt = nil
        loaded = false
        loadError = nil
        draft = ""
    }
}
