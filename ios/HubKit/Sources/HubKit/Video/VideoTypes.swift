import Foundation
import HubAPI
import OpenAPIRuntime

public typealias VideoSummary = Components.Schemas.VideoReviewSummary
public typealias VideoDetail = Components.Schemas.VideoReviewDetail
public typealias ScoreboardRow = Components.Schemas.ScoreboardRow

/// What a review says (VID-3): a model's review, or the combined advice with
/// each point agreed or disputed (VID-3c). The API sends these as JSON
/// without a schema; they're decoded here.
public struct ReviewContent: Codable, Sendable, Equatable {
    public struct Point: Codable, Sendable, Equatable {
        public var text: String
        /// "m:ss" in the reviewed clip, or nil.
        public var at: String?
        public var why: String
        public var status: String?
        public var sides: Sides?
        public var disputed: Bool { status == "disputed" }
    }

    public struct Sides: Codable, Sendable, Equatable {
        public var `for`: String
        public var against: String
    }

    public struct Drill: Codable, Sendable, Equatable {
        public var name: String
        public var how: String
        public var reps: String
    }

    public var summary: String
    public var good: [Point]
    public var fix: [Point]
    public var drills: [Drill]
    public var filmNext: String
}

/// A judge's scores for one review, 1–5 on each criterion (VID-3b).
public struct ReviewScores: Codable, Sendable, Equatable {
    public var grounded: Int
    public var correct: Int
    public var ageAppropriate: Int
    public var actionable: Int
    public var prioritised: Int
    public var total: Int?

    /// Each criterion with its name, in the web's order.
    public var criteria: [(label: String, score: Int)] {
        [("Grounded", grounded), ("Correct technique", correct), ("Age-appropriate", ageAppropriate),
         ("Actionable", actionable), ("Prioritised", prioritised)]
    }

    public var sum: Int { total ?? (grounded + correct + ageAppropriate + actionable + prioritised) }
}

/// Round 2: a judge's critique of both reviews, blind (A and B).
public struct Critique: Codable, Sendable, Equatable {
    public struct Entry: Codable, Sendable, Equatable {
        public struct Error: Codable, Sendable, Equatable {
            public var point: String
            public var reason: String
        }
        public var label: String
        public var unsupported: [String]
        public var errors: [Error]
        public var missed: [String]
        public var comment: String
    }
    public var reviews: [Entry]
}

/// Round 3: a model's replies to the critique of its review.
public struct Rebuttal: Codable, Sendable, Equatable {
    public struct Reply: Codable, Sendable, Equatable {
        public var point: String
        public var response: String
        public var argument: String
        public var at: String?
    }
    public var replies: [Reply]
}

extension OpenAPIValueContainer {
    /// Re-reads this JSON as a Swift type.
    public func decoded<T: Decodable>(as type: T.Type = T.self) -> T? {
        guard let data = try? JSONEncoder().encode(self) else { return nil }
        return try? JSONDecoder().decode(T.self, from: data)
    }
}

public enum VideoModel: String, CaseIterable, Sendable {
    case gemini, claude
    public var label: String { self == .gemini ? "Gemini" : "Claude" }
}

extension VideoDetail {
    /// The advice to follow: the combined review, or in single-model mode
    /// the one review.
    public var advice: ReviewContent? { combinedReview.decoded() }

    /// One model's own first review (round 1).
    public func review(by model: VideoModel) -> ReviewContent? {
        rounds.first { $0.round == "review" && $0.model.rawValue == model.rawValue }?.output.decoded()
    }

    /// The judges' scores of each model's review: first (critique) and final.
    public func scores(round: String) -> [(judge: VideoModel, of: VideoModel, scores: ReviewScores)] {
        rounds.filter { $0.round == round }.flatMap { r -> [(VideoModel, VideoModel, ReviewScores)] in
            guard let judge = VideoModel(rawValue: r.model.rawValue),
                  let byModel: [String: ReviewScores] = r.scores.decoded()
            else { return [] }
            return VideoModel.allCases.compactMap { m in byModel[m.rawValue].map { (judge, m, $0) } }
        }
    }

    /// Each judge's critique, with the blind labels mapped back to models.
    public var critiques: [(judge: VideoModel, of: VideoModel, entry: Critique.Entry)] {
        rounds.filter { $0.round == "critique" }.flatMap { r -> [(VideoModel, VideoModel, Critique.Entry)] in
            guard let judge = VideoModel(rawValue: r.model.rawValue),
                  let critique: Critique = r.output.decoded(),
                  let labels: [String: String] = r.labels.decoded()
            else { return [] }
            return critique.reviews.compactMap { e in labels[e.label].flatMap(VideoModel.init(rawValue:)).map { (judge, $0, e) } }
        }
    }

    public var rebuttals: [(model: VideoModel, rebuttal: Rebuttal)] {
        rounds.filter { $0.round == "rebuttal" }.compactMap { r in
            guard let m = VideoModel(rawValue: r.model.rawValue), let reb: Rebuttal = r.output.decoded() else { return nil }
            return (m, reb)
        }
    }

    public var isRunning: Bool { VideoStatus.running(status) }
}

public enum VideoStatus {
    public static func label(_ status: String) -> String {
        switch status {
        case "queued": "Queued"
        case "picking": "Waiting for your pick"
        case "analysing": "Reviewing…"
        case "done": "Done"
        case "failed": "Failed"
        case "saved": "Saved (not reviewed)"
        default: status
        }
    }

    public static func running(_ status: String) -> Bool { ["queued", "picking", "analysing"].contains(status) }
}

public enum VideoSport {
    public static let all = ["tennis", "swimming", "soccer", "hockey", "other"]
    /// The New review choice "Detect automatically" (intent 0005, SPT-1).
    public static let auto = "auto"

    /// How a review's sport is named, by where it came from (SPT-4).
    public static func text(_ sport: String, source: String) -> String {
        switch source {
        case "detecting", "unsure": "Sport not set"
        case "detected": "\(label(sport)) (detected)"
        default: label(sport)
        }
    }

    /// Whether the owner still has to set the sport (SPT-3).
    public static func unset(source: String, running: Bool) -> Bool {
        source == "unsure" || (source == "detecting" && !running)
    }

    public static func label(_ sport: String) -> String {
        switch sport {
        case "tennis": "Tennis"
        case "swimming": "Swimming"
        case "soccer": "Soccer"
        case "hockey": "Hockey"
        default: "Other"
        }
    }
}

/// Links the share sheet is given (EXT-3).
public enum VideoLink {
    /// A Google Photos share link: the API can't read it (F-4), so the video
    /// has to be picked in Google Photos instead.
    public static func isPhotosShare(_ url: URL) -> Bool {
        guard let host = url.host()?.lowercased() else { return false }
        return host == "photos.app.goo.gl" || host == "photos.google.com" || host.hasSuffix(".photos.google.com")
    }

    /// Noon on a yyyy-MM-dd day as the phone sees it (for a date picker).
    public static func date(_ s: String, calendar: Calendar = .current) -> Date? {
        let p = s.split(separator: "-").compactMap { Int($0) }
        guard p.count == 3 else { return nil }
        return calendar.date(from: DateComponents(year: p[0], month: p[1], day: p[2], hour: 12))
    }

    /// yyyy-MM-dd for a day as the phone sees it.
    public static func day(_ date: Date, calendar: Calendar = .current) -> String {
        let c = calendar.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", c.year!, c.month!, c.day!)
    }
}

/// The review's points on the clip's timeline (PLAY-4, PLAY-5), as on the web.
public enum VideoTimeline {
    public struct Point: Sendable, Equatable, Identifiable {
        /// "good-0", "fix-2": the section and the point's place in it.
        public let id: String
        public let good: Bool
        public let text: String
        public let seconds: Double
        public let disputed: Bool

        /// "Good", "Fix 2", "Fix 2 (disputed)".
        public var label: String {
            if good { return "Good" }
            let n = (Int(id.split(separator: "-").last ?? "0") ?? 0) + 1
            return "Fix \(n)" + (disputed ? " (disputed)" : "")
        }
    }

    /// How long a point stays up after its time.
    public static let showFor: Double = 2
    /// The clip is at most 30 frames a second.
    public static let frame: Double = 1.0 / 30

    /// The first "m:ss" in a cited time ("0:04-0:06", "00:04").
    public static func seconds(_ at: String?) -> Double? {
        guard let at, let r = at.range(of: #"(\d+):([0-5]\d(?:\.\d+)?)"#, options: .regularExpression) else { return nil }
        let parts = at[r].split(separator: ":")
        guard parts.count == 2, let m = Double(parts[0]), let s = Double(parts[1]) else { return nil }
        return m * 60 + s
    }

    public static func points(_ review: ReviewContent) -> [Point] {
        var out: [Point] = []
        for (good, list) in [(true, review.good), (false, review.fix)] {
            for (i, p) in list.enumerated() {
                if let sec = seconds(p.at) {
                    out.append(Point(id: "\(good ? "good" : "fix")-\(i)", good: good, text: p.text, seconds: sec, disputed: p.disputed))
                }
            }
        }
        return out.sorted { $0.seconds < $1.seconds }
    }

    /// The point on screen at time t: the latest whose window holds t.
    public static func active(_ points: [Point], at t: Double) -> Point? {
        points.last { $0.seconds <= t && t < $0.seconds + showFor }
    }

    /// "0:07".
    public static func clock(_ seconds: Double) -> String {
        let whole = Int(seconds.rounded())
        return "\(whole / 60):" + String(format: "%02d", whole % 60)
    }

    /// "1:05" or "65" → seconds; nil when blank; throws on nonsense.
    public static func parse(_ text: String) -> Double?? {
        let v = text.trimmingCharacters(in: .whitespaces)
        if v.isEmpty { return .some(nil) }
        let parts = v.split(separator: ":", omittingEmptySubsequences: false)
        switch parts.count {
        case 1: return Double(v).map { .some($0) } ?? nil
        case 2:
            guard let m = Int(parts[0]), let s = Double(parts[1]), s < 60 else { return nil }
            return .some(Double(m) * 60 + s)
        default: return nil
        }
    }
}
