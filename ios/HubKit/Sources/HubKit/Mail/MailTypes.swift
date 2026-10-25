import Foundation
import HubAPI
import OpenAPIRuntime

/// Today's mail (intent 0025, MD, MT, MG, MA).
public typealias MailView = Components.Schemas.MailView
public typealias MailDay = Components.Schemas.MailDayView
public typealias MailItem = Components.Schemas.MailItemView
public typealias MailTodo = Components.Schemas.MailTodoView
public typealias MailScript = Components.Schemas.MailScript
public typealias MailSpeechPart = Components.Schemas.MailSpeechPart

/// The topics the summarizer picks from (MG-2), in the order the screen and
/// the spoken digest use.
public enum MailTopic: String, CaseIterable, Sendable {
    case school, tennis, swimming, soccer, activities, household, other

    public init(_ raw: String) { self = MailTopic(rawValue: raw) ?? .other }

    public var label: String {
        switch self {
        case .school: "School"
        case .tennis: "Tennis"
        case .swimming: "Swimming"
        case .soccer: "Soccer"
        case .activities: "Activities"
        case .household: "Household"
        case .other: "Other"
        }
    }

    public var symbol: String {
        switch self {
        case .school: "graduationcap"
        case .tennis: "tennisball"
        case .swimming: "figure.pool.swim"
        case .soccer: "soccerball"
        case .activities: "figure.run"
        case .household: "house"
        case .other: "envelope"
        }
    }
}

extension MailItem {
    /// Worth reading: summarized and not routine (MD-4).
    public var isReadable: Bool { summary != nil && !routine }

    /// Shown when any of its people is, or always when it's for the family
    /// (MG-1, MG-3).
    public func isVisible(hiddenPeople: Set<String>) -> Bool {
        people.isEmpty || people.contains { !hiddenPeople.contains($0) }
    }
}

public enum MailGroups {
    /// A day's readable mail by topic, in MailTopic order, newest first in
    /// each (MG-3).
    public static func byTopic(_ items: [MailItem], hiddenPeople: Set<String> = []) -> [(topic: MailTopic, items: [MailItem])] {
        let readable = items.filter { $0.isReadable && $0.isVisible(hiddenPeople: hiddenPeople) }
        return MailTopic.allCases.compactMap { topic in
            let group = readable.filter { MailTopic($0.topic) == topic }
            return group.isEmpty ? nil : (topic, group)
        }
    }

    /// "Also came in": routine mail and mail listed by subject only (MD-4,
    /// MD-7, MSEC-5).
    public static func others(_ items: [MailItem]) -> [MailItem] {
        items.filter { !$0.isReadable }
    }

    /// Why an email has no summary, in words.
    public static func skippedReason(_ item: MailItem) -> String? {
        switch item.skipped {
        case .limit: "Too much mail today to summarize all of it."
        case .cap: "Cookie reached this month's limit."
        case .failed: "Couldn't read it; the next sync tries again."
        default: nil
        }
    }

    /// The Today card's line (MD-6): "3 emails, 2 to do".
    public static func cardLine(_ view: MailView) -> String {
        let today = view.days.first { $0.day == view.today }?.items.filter(\.isReadable).count ?? 0
        let emails = today == 1 ? "1 email" : "\(today) emails"
        let unread = view.unread > 0 && Int(view.unread) < today ? " (\(Int(view.unread)) new)" : ""
        return "\(emails)\(unread), \(Int(view.openTodos)) to do"
    }

    /// Whether Today shows the card: mail today, or open to-dos.
    public static func showsCard(_ view: MailView) -> Bool {
        view.days.contains { $0.day == view.today } || view.openTodos > 0
    }
}

/// The parts of the spoken digest and where playback is (MA-1, MA-3). Back
/// and next are the previous and next part.
public struct MailQueue: Equatable, Sendable {
    public let parts: [MailSpeechPart]
    public private(set) var index: Int

    public init(parts: [MailSpeechPart], index: Int = 0) {
        self.parts = parts
        self.index = min(max(index, 0), max(parts.count - 1, 0))
    }

    public var current: MailSpeechPart? { parts.indices.contains(index) ? parts[index] : nil }
    public var hasNext: Bool { index + 1 < parts.count }
    public var hasPrevious: Bool { index > 0 }

    /// False at the end.
    @discardableResult
    public mutating func next() -> Bool {
        guard hasNext else { return false }
        index += 1
        return true
    }

    public mutating func previous() {
        if hasPrevious { index -= 1 }
    }
}

/// The day's spoken parts, kept on this phone so a second play costs
/// nothing (MA-2). Other days are removed when a day is opened; files are
/// readable only while the phone is unlocked or open.
public struct MailAudioCache: Sendable {
    public let folder: URL

    public init(folder: URL = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0].appendingPathComponent("mail-audio")) {
        self.folder = folder
    }

    private func dayFolder(_ day: String) -> URL { folder.appendingPathComponent(day, isDirectory: true) }

    public func url(day: String, part: String) -> URL {
        dayFolder(day).appendingPathComponent("\(part).mp3")
    }

    public func read(day: String, part: String) -> Data? {
        try? Data(contentsOf: url(day: day, part: part))
    }

    public func write(_ data: Data, day: String, part: String) {
        let fm = FileManager.default
        try? fm.createDirectory(at: dayFolder(day), withIntermediateDirectories: true)
        let target = url(day: day, part: part)
        #if os(iOS)
        try? data.write(to: target, options: [.atomic, .completeFileProtectionUnlessOpen])
        #else
        try? data.write(to: target, options: .atomic)
        #endif
    }

    /// Keeps only `day`.
    public func keepOnly(_ day: String) {
        let fm = FileManager.default
        let days = (try? fm.contentsOfDirectory(atPath: folder.path)) ?? []
        for other in days where other != day { try? fm.removeItem(at: folder.appendingPathComponent(other)) }
    }

    /// Clear history (MSEC-3) and sign-out.
    public func wipe() { try? FileManager.default.removeItem(at: folder) }
}

/// One spoken part from the server (MA-2), or nil: the phone's own voice
/// reads it then (switched off, near the cap, offline, or not answering).
public enum MailVoice {
    public static func fetch(_ api: Client, day: String, part: String) async -> Data? {
        guard let body = try? await api.getMailSpeech(path: .init(part: part), query: .init(day: day)).ok.body.audioMpeg,
              let data = try? await Data(collecting: body, upTo: 4 * 1024 * 1024), !data.isEmpty
        else { return nil }
        return data
    }
}
