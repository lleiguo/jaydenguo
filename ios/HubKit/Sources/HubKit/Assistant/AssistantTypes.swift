import Foundation
import HubAPI

public typealias CookieAnswer = Components.Schemas.AskResult
public typealias CookieTurn = Components.Schemas.TurnView
public typealias CookieSource = Components.Schemas.AssistantSource
public typealias CookieSettings = Components.Schemas.AssistantSettingsResponse
public typealias CookieMemory = Components.Schemas.MemoryView

/// One bubble in the chat with Cookie (intent 0007, CK-4).
public struct CookieMessage: Identifiable, Equatable, Sendable {
    public enum Role: Sendable { case you, cookie }

    /// How an answer ended: a bark is its own thing (CHR-2), and a limit or
    /// an error isn't something she said about the hub.
    public enum Kind: Sendable { case answer, bark, notice }

    public struct Link: Equatable, Sendable {
        public let label: String
        public let url: URL
    }

    public let id: String
    public let role: Role
    public let text: String
    public let kind: Kind
    /// "From Calendar, Tennis" (CHR-4); nil when she answered from herself.
    public let sourceLine: String?
    /// Web pages she used, to open in the browser.
    public let links: [Link]
    /// A fact this answer saved or forgot, with the id to undo it (MEM-2).
    public let memory: MemoryChange?
    /// Events this answer added, as cards with Undo (intent 0008, ACT-1).
    public let changes: CookieChanges?

    public struct MemoryChange: Equatable, Sendable {
        public enum Kind: Sendable { case saved, forgot }
        public let kind: Kind
        public let id: String
        public let text: String

        /// "Saved to memory" / "Forgotten", beside the Undo button.
        public var label: String { kind == .saved ? "Saved to memory" : "Forgotten" }
    }

    public init(
        id: String, role: Role, text: String, kind: Kind = .answer, sourceLine: String? = nil, links: [Link] = [],
        memory: MemoryChange? = nil, changes: CookieChanges? = nil
    ) {
        self.id = id
        self.role = role
        self.text = text
        self.kind = kind
        self.sourceLine = sourceLine
        self.links = links
        self.memory = memory
        self.changes = changes
    }

    /// The same answer with its changes as they are now.
    public func with(changes: CookieChanges?) -> CookieMessage {
        CookieMessage(
            id: id, role: role, text: text, kind: kind, sourceLine: sourceLine, links: links, memory: memory,
            changes: changes
        )
    }

    /// The same answer without its memory Undo, once used or expired.
    public func withoutMemory() -> CookieMessage {
        CookieMessage(id: id, role: role, text: text, kind: kind, sourceLine: sourceLine, links: links, changes: changes)
    }

    /// What VoiceOver reads for the bubble.
    public var spokenLabel: String {
        let who = role == .you ? "You asked" : kind == .bark ? "Cookie barked" : "Cookie"
        return [who + ": " + text, sourceLine].compactMap { $0 }.joined(separator: ". ")
    }
}

/// The chat's rules, kept out of the views so they're tested without a
/// simulator.
public enum CookieChat {
    /// LIM-3: the server refuses longer questions.
    public static let questionLimit = 500
    /// MEM-8: a follow-up within this long continues the conversation.
    public static let followUpWindow: TimeInterval = 30 * 60

    public static func question(_ draft: String) -> String? {
        let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        return text.isEmpty || text.count > questionLimit ? nil : text
    }

    /// History as bubbles, oldest first: each turn is the question, then
    /// what she said. Turns whose words were cleared are left out.
    public static func messages(_ turns: [CookieTurn]) -> [CookieMessage] {
        turns.flatMap { turn -> [CookieMessage] in
            guard let heard = turn.heard, let text = turn.text else { return [] }
            // A recording with no words in it has no question to show.
            let question = heard.isEmpty ? [] : [CookieMessage(id: turn.id + "-q", role: .you, text: heard)]
            return question + [
                CookieMessage(
                    id: turn.id, role: .cookie, text: text, kind: kind(turn.outcome.rawValue),
                    sourceLine: sourceLine(turn.sources), links: links(turn.sources),
                    // Unlike a saved fact, a change keeps its Undo for ten minutes, after a restart too.
                    changes: turn.did.map { CookieChanges(turnId: turn.id, did: $0) }
                ),
            ]
        }
    }

    public static func message(_ answer: CookieAnswer) -> CookieMessage {
        // Only a fresh answer can be undone; history shows what was said.
        let memory: CookieMessage.MemoryChange? =
            answer.saved.map { .init(kind: .saved, id: $0.id, text: $0.text) }
            ?? answer.forgot.map { .init(kind: .forgot, id: $0.id, text: $0.text) }
        return CookieMessage(
            id: answer.turnId, role: .cookie, text: answer.text, kind: kind(answer.outcome.rawValue),
            sourceLine: sourceLine(answer.sources), links: links(answer.sources), memory: memory,
            changes: answer.did.map { CookieChanges(turnId: answer.turnId, did: $0) }
        )
    }

    /// MEM-1: the server refuses longer facts.
    public static let factLimit = 300

    public static func fact(_ draft: String) -> String? {
        let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        return text.isEmpty || text.count > factLimit ? nil : text
    }

    /// The conversation a new question continues: the last turn's, while
    /// it's recent enough for the server to send it along (MEM-8).
    public static func conversation(after turns: [CookieTurn], now: Date = .now) -> String? {
        guard let last = turns.last, let at = HomeTime.parse(last.createdAt),
              now.timeIntervalSince(at) < followUpWindow
        else { return nil }
        return last.conversationId
    }

    static func kind(_ outcome: String) -> CookieMessage.Kind {
        switch outcome {
        case "answer": .answer
        case "bark": .bark
        default: .notice
        }
    }

    /// "From Calendar, Tennis": where the answer came from (CHR-4).
    static func sourceLine(_ sources: [CookieSource]) -> String? {
        let labels = sources.compactMap { source -> String? in
            switch source.kind {
            case ._self: nil
            case .conversation: "earlier in this chat"
            case .web: "the web: " + source.label
            case .hub, .memory: source.label
            }
        }
        return labels.isEmpty ? nil : "From " + labels.joined(separator: ", ")
    }

    static func links(_ sources: [CookieSource]) -> [CookieMessage.Link] {
        sources.compactMap { source in
            guard source.kind == .web, let text = source.url, let url = URL(string: text),
                  url.scheme == "https"
            else { return nil }
            return .init(label: source.label, url: url)
        }
    }
}

extension CookieMemory {
    /// "Saved by pat on 2 Oct" (MEM-4): the account's name, not its address.
    public func savedLine(_ time: HomeTime) -> String {
        let who = savedBy.split(separator: "@").first.map(String.init) ?? savedBy
        let when = HomeTime.parse(forgottenAt ?? createdAt).map { time.dayTitle(time.localDate($0)) } ?? ""
        return forgottenAt == nil ? "Saved by \(who) · \(when)" : "Forgotten · \(when)"
    }
}
