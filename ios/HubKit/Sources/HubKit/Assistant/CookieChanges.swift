import Foundation
import HubAPI

public typealias CookieDid = Components.Schemas.Did

/// What one of Cookie's answers changed in the calendar (intent 0008,
/// ACT-1): a card for each event under the answer, and Undo for ten
/// minutes (ACT-3).
public struct CookieChanges: Equatable, Sendable {
    public struct Card: Identifiable, Equatable, Sendable {
        public enum State: Sendable {
            /// In the hub, on its way to the family calendar (GCW-4).
            case adding
            case added
            /// The family calendar refused it, so the hub removed it (GCW-7).
            case failed
            case undone
        }

        /// What happened to the event: an email suggestion can also move or
        /// cancel one (intent 0008, EMS-3, EMS-4).
        public enum Change: Sendable { case added, moved, cancelled }

        /// Stable within the answer, so a card keeps its place as it changes.
        public let id: String
        /// The hub's event, to open; nil once it's gone.
        public let eventId: String?
        public let title: String
        public let start: String
        public let end: String
        public let allDay: Bool
        public let owners: [String]
        public let state: State
        public let change: Change
        /// From an email suggestion: it stays in the hub, not the family's
        /// Google Calendar (EMS-6).
        public let fromEmail: Bool

        /// "Thursday, 3 December · 6:00 – 7:00 PM", in the home time zone.
        /// All-day events are stored at the UTC midnights of their dates.
        public func whenLine(_ time: HomeTime) -> String {
            if allDay { return time.dayTitle(String(start.prefix(10))) + " · All day" }
            guard let s = HomeTime.parse(start) else { return start }
            return time.dayTitle(time.localDate(s)) + " · " + time.range(start, end)
        }

        /// "For Sam" / "For Sam and Alex"; nil for the whole family.
        public var whoLine: String? {
            owners.isEmpty ? nil : "For " + owners.formatted(.list(type: .and))
        }

        public var stateLine: String {
            switch (state, change) {
            case (.adding, _): "Being added to the family calendar…"
            case (.added, .added): fromEmail ? "Added from email" : "Added to the family calendar"
            case (.added, .moved): "Moved, as the email said"
            case (.added, .cancelled): "Cancelled, as the email said"
            case (.failed, _): "Couldn't be added to the family calendar"
            case (.undone, _): "Undone"
            }
        }

        /// Only an event still in the hub opens; a cancelled one too, to see it.
        public var opens: Bool { eventId != nil && (state == .adding || state == .added) }

        public func spokenLabel(_ time: HomeTime) -> String {
            [title, whenLine(time), whoLine, stateLine].compactMap { $0 }.joined(separator: ". ")
        }
    }

    public let turnId: String
    public let cards: [Card]
    /// Until when the answer offers Undo; nil once nothing is left to undo.
    public let undoUntil: Date?

    public init(turnId: String, did: CookieDid) {
        self.turnId = turnId
        cards = did.events.enumerated().map { index, e in
            Card(
                id: "\(turnId)-\(index)", eventId: e.id, title: e.title, start: e.start, end: e.end,
                allDay: e.allDay, owners: e.owners, state: Self.state(e.state),
                change: Self.change(e.change), fromEmail: e.via == .email
            )
        }
        undoUntil = did.undoUntil.flatMap(HomeTime.parse)
    }

    public func canUndo(now: Date = .now) -> Bool {
        guard let undoUntil else { return false }
        return now < undoUntil
    }

    /// Whether a card is still waiting on the worker, so the app asks again.
    public var isSettling: Bool { cards.contains { $0.state == .adding } }

    static func change(_ change: Components.Schemas.AppliedKind) -> Card.Change {
        switch change {
        case .added: .added
        case .moved: .moved
        case .cancelled: .cancelled
        }
    }

    static func state(_ state: Components.Schemas.DidEvent.StatePayload) -> Card.State {
        switch state {
        case .adding: .adding
        case .added: .added
        case .failed: .failed
        case .undone: .undone
        }
    }
}

extension CookieChat {
    /// How often a card that is still being added asks again, and for how
    /// long: the worker usually writes within 20 seconds (SP-E2), and gives
    /// up on Google after a little over a minute (GCW-7).
    public static let settleInterval: Duration = .seconds(4)
    public static let settleLimit: TimeInterval = 3 * 60

    /// History brought up to date from fresh turns: each answer's changes
    /// as they are now, whether it still waits for an email summary, and
    /// the summaries that have arrived since (intent 0009, ERA-1), added at
    /// the end. Everything else stays as it is.
    public static func refreshed(_ messages: [CookieMessage], from turns: [CookieTurn]) -> [CookieMessage] {
        let byId = Dictionary(turns.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
        let known = Set(messages.map(\.id))
        let updated = messages.map { message -> CookieMessage in
            guard let turn = byId[message.id] else { return message }
            var next = message
            if message.changes != nil, let did = turn.did { next = next.with(changes: CookieChanges(turnId: turn.id, did: did)) }
            if message.waitingUntil != nil, turn.waiting == nil { next = next.notWaiting() }
            return next
        }
        let arrived = turns.filter { $0.followup == true && !known.contains($0.id) }
        return updated + CookieChat.messages(arrived)
    }

    /// Whether the chat should ask the server again: a card being added,
    /// or an email summary on its way.
    public static func needsRefresh(_ messages: [CookieMessage], now: Date = .now) -> Bool {
        messages.contains { $0.changes?.isSettling == true || $0.isWaiting(now: now) }
    }
}

extension HubClient {
    /// "Undo" under an answer that changed the calendar (ACT-3): what that
    /// answer did, as it is after the undo.
    public func undoCookieChanges(turnId: String) async throws -> CookieChanges {
        CookieChanges(turnId: turnId, did: try await api.undoAssistantActions(path: .init(turnId: turnId)).ok.body.json)
    }
}
