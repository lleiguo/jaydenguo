import Foundation
import HubAPI

public typealias CalendarEvent = Components.Schemas.EventView
public typealias CalendarClash = Components.Schemas.ClashView
public typealias CalendarPayload = Components.Schemas.CalendarPayload
public typealias Person = Components.Schemas.Person
public typealias Undo = Components.Schemas.Undo
public typealias EventCategory = CalendarEvent.CategoryPayload

/// Name and symbol per category (CAL-1), so colour is never the only cue.
/// Colours are the app's (they're view code).
extension CalendarEvent.CategoryPayload {
    public var label: String {
        switch self {
        case .tennis: "Tennis"
        case .swimming: "Swimming"
        case .soccer: "Soccer"
        case .hockey: "Hockey"
        case .math: "Math"
        case .chinese: "Chinese"
        case .fitness: "Fitness"
        case .schoolClass: "School class"
        case .schoolClosure: "School closed"
        case .other: "Other"
        }
    }

    public var symbol: String {
        switch self {
        case .tennis: "tennisball.fill"
        case .swimming: "figure.pool.swim"
        case .soccer: "soccerball"
        case .hockey: "figure.hockey"
        case .math: "divide.circle.fill"
        case .chinese: "character.book.closed.fill"
        case .fitness: "figure.strengthtraining.traditional"
        case .schoolClass: "graduationcap.fill"
        case .schoolClosure: "xmark.octagon.fill"
        case .other: "circle.fill"
        }
    }
}

extension CalendarEvent {
    public var startDate: Date? { HomeTime.parse(start) }
    public var endDate: Date? { HomeTime.parse(end) }
    public var isCancelled: Bool { status == .cancelled }
    public var isSkipped: Bool { override?.skip == true }
    public var isFromSource: Bool { source != nil }

    /// The dates an all-day event covers. All-day events are stored as UTC
    /// midnights of their dates (the web does the same), so the dates come
    /// from the UTC string, not the home zone.
    public var allDayDates: (first: String, lastExclusive: String) {
        let first = String(start.prefix(10))
        let endDay = String(end.prefix(10))
        return (first, endDay > first ? endDay : CalendarDates.add(days: 1, to: first))
    }
}

/// Plain yyyy-MM-dd arithmetic, independent of time zones.
public enum CalendarDates {
    private static let utc: Calendar = {
        var c = Calendar(identifier: .gregorian)
        c.timeZone = TimeZone(identifier: "UTC")!
        return c
    }()

    public static func date(_ s: String) -> Date? {
        let p = s.split(separator: "-").compactMap { Int($0) }
        guard p.count == 3 else { return nil }
        return utc.date(from: DateComponents(year: p[0], month: p[1], day: p[2]))
    }

    public static func string(_ d: Date) -> String {
        let c = utc.dateComponents([.year, .month, .day], from: d)
        return String(format: "%04d-%02d-%02d", c.year!, c.month!, c.day!)
    }

    public static func add(days: Int, to s: String) -> String {
        guard let d = date(s), let n = utc.date(byAdding: .day, value: days, to: d) else { return s }
        return string(n)
    }

    public static func add(months: Int, to s: String) -> String {
        guard let d = date(s), let n = utc.date(byAdding: .month, value: months, to: d) else { return s }
        return string(n)
    }

    /// 0 = Sunday … 6 = Saturday (the API's weekday numbers).
    public static func weekday(_ s: String) -> Int {
        guard let d = date(s) else { return 0 }
        return utc.component(.weekday, from: d) - 1
    }

    /// The Monday on or before a date.
    public static func weekStart(_ s: String) -> String {
        add(days: -((weekday(s) + 6) % 7), to: s)
    }

    public static func monthStart(_ s: String) -> String { String(s.prefix(8)) + "01" }

    public static func days(from: String, count: Int) -> [String] {
        (0..<count).map { add(days: $0, to: from) }
    }

    /// The weeks (Monday first) a month's grid shows.
    public static func monthGrid(_ s: String) -> [[String]] {
        let first = monthStart(s)
        let nextMonth = add(months: 1, to: first)
        var week = weekStart(first)
        var weeks: [[String]] = []
        while week < nextMonth {
            weeks.append(days(from: week, count: 7))
            week = add(days: 7, to: week)
        }
        return weeks
    }
}
