import Foundation
import HubAPI
import OpenAPIRuntime

public typealias TennisOverview = Components.Schemas.TennisOverview
public typealias TournamentView = Components.Schemas.TournamentView
public typealias DrawView = Components.Schemas.DrawView
public typealias MatchView = Components.Schemas.MatchView
public typealias Perspective = Components.Schemas.Perspective
public typealias PredictionView = Components.Schemas.PredictionView
public typealias WinLoss = Components.Schemas.WinLoss
public typealias UpcomingStatus = Components.Schemas.UpcomingStatus

/// His next match in a draw (TEN-3), from the API's union of shapes.
public enum NextMatch: Equatable, Sendable {
    case next(round: String, opponent: String?, feeders: [String]?, date: String?, time: String?)
    case won
    case out
    case notDrawn

    /// "Next: Semi final vs X · 2026-10-11 10:30", as on the web.
    public var line: String {
        switch self {
        case .won: return "Won the draw 🏆"
        case .out: return "Finished in this draw"
        case .notDrawn: return "Not in the published draw"
        case let .next(round, opponent, feeders, date, time):
            let who: String
            if let opponent { who = opponent }
            else if let feeders, feeders.count == 2 { who = "winner of \(feeders[0]) vs \(feeders[1])" }
            else { who = "opponent to be decided" }
            let when = date.map { d in time.map { "\(d) \($0)" } ?? d }
            return "Next: \(round) vs \(who)" + (when.map { " · \($0)" } ?? "")
        }
    }
}

extension DrawView {
    public var nextMatch: NextMatch? {
        guard let n = next else { return nil }
        if let v = n.value1 {
            let feeders = v.feeders.map { $0.value.compactMap { $0 as? String } }
            return .next(round: v.round, opponent: v.opponent?.name, feeders: feeders, date: v.date, time: v.time)
        }
        switch n.value2?.status {
        case .won: return .won
        case .out: return .out
        case .notDrawn: return .notDrawn
        case nil: return nil
        }
    }

    /// "U12 Boys Singles · Main draw (withdrawn)".
    public var title: String {
        var t = eventName ?? drawName ?? "Draw"
        if let d = drawName, let e = eventName, d != e { t += " · \(d)" }
        if status == .withdrawn { t += " (withdrawn)" }
        return t
    }

    /// "line 5 of 16 · seed 3", or nil when there's nothing to say.
    public var placeLine: String? {
        var parts: [String] = []
        if let p = position, let s = size { parts.append("line \(Int(p)) of \(Int(s))") }
        if let seed { parts.append("seed \(seed)") }
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }
}

extension UpcomingStatus {
    public var kind: String { value1?.kind.rawValue ?? value2?.kind.rawValue ?? "" }
    public var label: String { value1?.label ?? value2?.label ?? "" }
    /// A step the owner finishes on the site (enter or pay), https only.
    public var action: (text: String, url: URL)? {
        guard let a = value1?.action, let url = URL(string: a.url), url.scheme == "https" else { return nil }
        return (a.text, url)
    }
}

public enum TennisFormat {
    /// "3–2".
    public static func record(_ r: WinLoss) -> String { "\(Int(r.wins))–\(Int(r.losses))" }
    public static func record(wins: Double, losses: Double) -> String { "\(Int(wins))–\(Int(losses))" }

    /// "72%".
    public static func percent(_ p: Double) -> String { "\(Int((p * 100).rounded()))%" }

    public static func dates(_ start: String, _ end: String) -> String { start == end ? start : "\(start) – \(end)" }

    /// Set scores as games pairs, in side order.
    public static func sets(_ raw: [Components.Schemas.SetScore]) -> [(Int, Int)] {
        raw.compactMap { set in
            let games = set.value.compactMap { v -> Int? in
                switch v {
                case let i as Int: i
                case let d as Double: Int(d)
                default: nil
                }
            }
            return games.count == 2 ? (games[0], games[1]) : nil
        }
    }

    /// "6–3 4–6 [10–8]" from one side, as the web shows it.
    public static func score(_ sets: [(Int, Int)], side: Int, dash: String = "–") -> String {
        sets.enumerated().map { i, s in
            let (x, y) = side == 1 ? s : (s.1, s.0)
            let tiebreak = i == 2 && max(s.0, s.1) >= 10 && abs(s.0 - s.1) >= 2
            return tiebreak ? "[\(x)\(dash)\(y)]" : "\(x)\(dash)\(y)"
        }.joined(separator: " ")
    }

    /// The score typed from his side, for the correction field ("6-3 4-6 10-8").
    public static func editableScore(_ sets: [(Int, Int)], side: Int) -> String {
        score(sets, side: side, dash: "-").replacingOccurrences(of: "[", with: "").replacingOccurrences(of: "]", with: "")
    }

    public static func outcomeNote(_ outcome: String) -> String? {
        switch outcome {
        case "walkover": "walkover"
        case "retired": "retired"
        default: nil
        }
    }
}

extension Perspective {
    /// 1 or 2: his side of the match.
    public var sideNumber: Int { Int(side.value1 ?? side.value2 ?? 1) }
    /// "W", "L", or nil before it's played.
    public var resultLetter: String? {
        guard let r = result, r != ._empty_ else { return nil }
        return r.rawValue
    }
    public var opponentNames: String { opponents.map(\.name).joined(separator: " / ") }
}

extension MatchView {
    public var isScheduled: Bool { outcome == .scheduled }

    /// What the site says when it disagrees with his correction (TEN-8),
    /// e.g. "W 6–3 6–4" or "not played yet".
    public func siteSays(side: Int) -> String? {
        guard let s = source else { return nil }
        if s.outcome == .scheduled { return "not played yet" }
        let winner = (s.winner?.value1 ?? s.winner?.value2).map(Int.init)
        let result = winner.map { $0 == side ? "W " : "L " } ?? ""
        let note = TennisFormat.outcomeNote(s.outcome.rawValue).map { " (\($0))" } ?? ""
        return (result + TennisFormat.score(TennisFormat.sets(s.sets), side: side) + note).trimmingCharacters(in: .whitespaces)
    }

    /// The start time in the home time zone, "17:30", for the correction field.
    public func localTime(_ homeTime: HomeTime) -> String? {
        scheduledAt.flatMap(HomeTime.parse).map(homeTime.hhmm)
    }
}
