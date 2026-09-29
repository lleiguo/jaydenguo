import Foundation
import HubAPI

/// Filters and people chips (CAL-3, CAL-3a), saved per device by the app.
public struct CalendarFilters: Codable, Equatable, Sendable {
    public var hiddenCategories: Set<String> = []
    public var hiddenSources: Set<String> = []
    /// `people.id`s whose events are hidden.
    public var hiddenPeople: Set<String> = []

    public init() {}

    public func isVisible(_ e: CalendarEvent) -> Bool {
        // Closure banners stay visible whoever is hidden (CAL-3a).
        if e.category == .schoolClosure { return true }
        // Shown while any of its people is.
        guard e.owners.contains(where: { !hiddenPeople.contains($0) }) else { return false }
        if hiddenCategories.contains(e.category.rawValue) { return false }
        if let source = e.source, hiddenSources.contains(source.id) { return false }
        return true
    }

    public var isFiltering: Bool { !hiddenCategories.isEmpty || !hiddenSources.isEmpty }
}

/// Where an event stands with clashes, given what's shown (CON-2, CAL-3a).
public enum ClashMark: Equatable, Sendable {
    case none
    /// Clashes with an event that's shown.
    case clash
    /// Clashes only with events hidden by the filters.
    case withHiddenEvent
}

/// One calendar load, indexed for the screens: events by id, clashes per
/// event, and what the filters show.
public struct CalendarIndex: Sendable {
    public let payload: CalendarPayload
    public let byId: [String: CalendarEvent]
    private let clashesByEvent: [String: [CalendarClash]]

    public init(_ payload: CalendarPayload) {
        self.payload = payload
        byId = Dictionary(payload.events.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
        var m: [String: [CalendarClash]] = [:]
        for c in payload.clashes {
            m[c.a, default: []].append(c)
            m[c.b, default: []].append(c)
        }
        clashesByEvent = m
    }

    public struct ClashWith: Sendable, Identifiable {
        public let clash: CalendarClash
        public let other: CalendarEvent?
        public var id: String { "\(clash.a)|\(clash.b)" }
    }

    public func clashes(of id: String) -> [ClashWith] {
        (clashesByEvent[id] ?? []).map { c in ClashWith(clash: c, other: byId[c.a == id ? c.b : c.a]) }
    }

    public func mark(for ids: [String], filters: CalendarFilters) -> ClashMark {
        let open = ids.flatMap { clashes(of: $0) }.filter { $0.clash.acceptedId == nil }
        if open.isEmpty { return .none }
        if open.contains(where: { $0.other.map(filters.isVisible) ?? true }) { return .clash }
        return .withHiddenEvent
    }

    /// Events the filters show; deleted events, and cancelled events added
    /// here, are left out.
    public func shown(_ filters: CalendarFilters) -> [CalendarEvent] {
        payload.events.filter { !($0.isCancelled && !$0.isFromSource) && $0.deletedAt == nil && filters.isVisible($0) }
    }

    /// The people an event names: none when it's only the primary person's.
    public func ownerNames(_ e: CalendarEvent) -> String? {
        let primary = payload.people.first { $0.isPrimary }?.id
        if e.owners.count == 1, e.owners.first == primary { return nil }
        let names = payload.people.filter { e.owners.contains($0.id) }.map(\.name)
        return names.isEmpty ? nil : names.joined(separator: ", ")
    }
}

/// SCH-1: a day's classes show as one "School" block until expanded; a day
/// with one class needs no block.
public struct SchoolBlock: Sendable, Identifiable {
    public let date: String
    public let start: String
    public let end: String
    public let classes: [CalendarEvent]
    public var id: String { "school:\(date)" }

    public static func blocks(_ events: [CalendarEvent], homeTime: HomeTime) -> [SchoolBlock] {
        var byDay: [String: [CalendarEvent]] = [:]
        for e in events where e.category == .schoolClass && !e.allDay {
            guard let s = e.startDate else { continue }
            byDay[homeTime.localDate(s), default: []].append(e)
        }
        return byDay.compactMap { date, classes -> SchoolBlock? in
            guard classes.count >= 2 else { return nil }
            let sorted = classes.sorted { ($0.startDate ?? .distantPast) < ($1.startDate ?? .distantPast) }
            let last = sorted.max { ($0.endDate ?? .distantPast) < ($1.endDate ?? .distantPast) }!
            return SchoolBlock(date: date, start: sorted[0].start, end: last.end, classes: sorted)
        }
        .sorted { $0.date < $1.date }
    }
}
