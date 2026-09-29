import Foundation

/// Which events fall on a home date, and how timed ones sit side by side.
public enum DayLayout {
    /// Events on a home date: timed ones that overlap its hours, and all-day
    /// ones whose dates include it. Timed ones by start, then title.
    public static func events(
        on date: String,
        from events: [CalendarEvent],
        homeTime: HomeTime
    ) -> (allDay: [CalendarEvent], timed: [CalendarEvent]) {
        guard let dayStart = homeTime.startOfDay(date),
              let dayEnd = homeTime.startOfDay(CalendarDates.add(days: 1, to: date))
        else { return ([], []) }
        var allDay: [CalendarEvent] = []
        var timed: [CalendarEvent] = []
        for e in events {
            if e.allDay {
                let d = e.allDayDates
                if d.first <= date && date < d.lastExclusive { allDay.append(e) }
            } else if let s = e.startDate, let t = e.endDate, s < dayEnd, max(t, s.addingTimeInterval(1)) > dayStart {
                timed.append(e)
            }
        }
        timed.sort { a, b in
            let (sa, sb) = (a.startDate ?? .distantPast, b.startDate ?? .distantPast)
            return sa != sb ? sa < sb : a.title < b.title
        }
        allDay.sort { $0.title < $1.title }
        return (allDay, timed)
    }

    public struct Placed<Item: Sendable>: Sendable {
        public let item: Item
        /// Minutes from the day's midnight, clamped to the day.
        public let startMinute: Double
        public let endMinute: Double
        public let column: Int
        public let columns: Int
    }

    /// Side-by-side columns for overlapping items: each group of items that
    /// overlap one another shares the width.
    public static func place<Item: Sendable>(
        _ items: [Item],
        on date: String,
        homeTime: HomeTime,
        start: (Item) -> Date?,
        end: (Item) -> Date?
    ) -> [Placed<Item>] {
        guard let midnight = homeTime.startOfDay(date),
              let next = homeTime.startOfDay(CalendarDates.add(days: 1, to: date))
        else { return [] }
        let dayLength = next.timeIntervalSince(midnight) / 60
        let spans: [LayoutSpan] = items.enumerated().compactMap { i, item -> LayoutSpan? in
            guard let a = start(item), let b = end(item) else { return nil }
            let s = min(dayLength - 20, max(0, a.timeIntervalSince(midnight) / 60))
            // Short events still get room for a line of text.
            let e = min(dayLength, max(b.timeIntervalSince(midnight) / 60, s + 20))
            return LayoutSpan(index: i, s: s, e: e)
        }
        .sorted { $0.s < $1.s }

        var result: [Placed<Item>] = []
        var group: [(span: LayoutSpan, column: Int)] = []
        var groupEnd = -Double.infinity
        func flush() {
            let columns = (group.map(\.column).max() ?? 0) + 1
            result += group.map {
                Placed(item: items[$0.span.index], startMinute: $0.span.s, endMinute: $0.span.e, column: $0.column, columns: columns)
            }
            group = []
        }
        for span in spans {
            if span.s >= groupEnd {
                flush()
                groupEnd = -Double.infinity
            }
            var column = 0
            while group.contains(where: { $0.column == column && $0.span.e > span.s }) { column += 1 }
            group.append((span, column))
            groupEnd = max(groupEnd, span.e)
        }
        flush()
        return result
    }
}

struct LayoutSpan {
    let index: Int
    let s: Double
    let e: Double
}

/// Moving an event keeps its length (CON-3). Drags snap to 15 minutes.
public enum EventMove {
    public static let snapMinutes = 15.0

    public static func snap(_ minutes: Double) -> Double {
        (minutes / snapMinutes).rounded() * snapMinutes
    }

    /// New start and end for a timed event dropped on `date` at `minute`
    /// (minutes after the home midnight).
    public static func timed(_ e: CalendarEvent, to date: String, minute: Double, homeTime: HomeTime) -> (start: Date, end: Date)? {
        guard let s = e.startDate, let t = e.endDate, let midnight = homeTime.startOfDay(date) else { return nil }
        let start = midnight.addingTimeInterval(snap(minute) * 60)
        return (start, start.addingTimeInterval(t.timeIntervalSince(s)))
    }

    /// New start and end for an all-day event moved to start on `date`: the
    /// UTC midnights of its dates, the stored form.
    public static func allDay(_ e: CalendarEvent, to date: String) -> (start: Date, end: Date)? {
        let d = e.allDayDates
        guard let old = CalendarDates.date(d.first), let oldEnd = CalendarDates.date(d.lastExclusive),
              let start = CalendarDates.date(date)
        else { return nil }
        return (start, start.addingTimeInterval(oldEnd.timeIntervalSince(old)))
    }

    /// Keeps the length, starting at `start` (the "Move to…" sheet).
    public static func starting(_ e: CalendarEvent, at start: Date) -> (start: Date, end: Date)? {
        guard let s = e.startDate, let t = e.endDate else { return nil }
        return (start, start.addingTimeInterval(t.timeIntervalSince(s)))
    }
}
