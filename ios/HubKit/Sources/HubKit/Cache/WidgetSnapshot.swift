import Foundation

/// What the widgets show (intent 0004, EXT-1, EXT-2): the next few days'
/// events for the people chosen in the app, with clashes marked, written by
/// the app next to the offline cache whenever it loads the calendar. The
/// widgets only read this file; they never call the API.
public struct WidgetSnapshot: Codable, Sendable, Equatable {
    public static let fileName = "widget.json"

    public var generatedAt: Date
    /// The home time zone (CAL-9): widgets show times there too.
    public var timeZone: String
    public var items: [Item]

    public struct Item: Codable, Sendable, Hashable {
        public var title: String
        /// The category's SF Symbol and name, so colour is never the only cue.
        public var symbol: String
        public var category: String
        public var start: Date
        public var end: Date
        public var allDay: Bool
        public var clash: Bool
        public var place: String?

        public init(title: String, symbol: String, category: String, start: Date, end: Date,
                    allDay: Bool, clash: Bool, place: String?) {
            self.title = title
            self.symbol = symbol
            self.category = category
            self.start = start
            self.end = end
            self.allDay = allDay
            self.clash = clash
            self.place = place
        }
    }

    public init(generatedAt: Date = .now, timeZone: String, items: [Item]) {
        self.generatedAt = generatedAt
        self.timeZone = timeZone
        self.items = items.sorted { ($0.allDay ? 0 : 1, $0.start) < ($1.allDay ? 0 : 1, $1.start) }
    }

    public var homeTime: HomeTime { HomeTime(identifier: timeZone) }

    /// Timed events that haven't ended yet, soonest first.
    public func upcoming(at now: Date) -> [Item] {
        items.filter { !$0.allDay && $0.end > now }.sorted { $0.start < $1.start }
    }

    /// Today's events (home date), all-day first.
    public func today(at now: Date) -> [Item] {
        let date = homeTime.localDate(now)
        return items.filter { item in
            if item.allDay {
                return CalendarDates.string(item.start) <= date && date < CalendarDates.string(item.end)
            }
            return homeTime.localDate(item.start) == date && item.end > now
        }
    }

    /// When a widget should redraw: now, each event's end (the next one
    /// moves up), and midnight in the home zone (a new day).
    public func timelineDates(from now: Date, limit: Int = 12) -> [Date] {
        var dates = [now]
        dates += upcoming(at: now).map(\.end)
        if let midnight = homeTime.startOfDay(CalendarDates.add(days: 1, to: homeTime.localDate(now))) {
            dates.append(midnight)
        }
        return Array(Set(dates.filter { $0 >= now })).sorted().prefix(limit).map { $0 }
    }

    /// What Siri says for "What's next" (EXT-4).
    public func spokenNext(at now: Date) -> String {
        guard let next = upcoming(at: now).first else { return "Nothing else is coming up in the next few days." }
        let place = next.place.map { " at \($0)" } ?? ""
        if next.start <= now { return "\(next.title), now until \(homeTime.time(next.end))\(place)." }
        let today = homeTime.localDate(now), day = homeTime.localDate(next.start)
        let when = day == today ? "at \(homeTime.time(next.start))"
            : day == CalendarDates.add(days: 1, to: today) ? "tomorrow at \(homeTime.time(next.start))"
            : "\(homeTime.dayTitle(day)) at \(homeTime.time(next.start))"
        return "\(next.title) \(when)\(place)."
    }

    /// What Siri says for "Today's schedule" (EXT-4): the rest of today.
    public func spokenToday(at now: Date) -> String {
        let items = today(at: now)
        guard !items.isEmpty else { return "Nothing else today." }
        return items.map { i in
            i.allDay ? "\(i.title), all day" : "\(homeTime.time(i.start)) \(i.title)\(i.clash ? " (clash)" : "")"
        }.joined(separator: "\n")
    }

    /// "Next: Swim 17:30" for the inline lock screen widget.
    public func inlineText(at now: Date) -> String {
        guard let next = upcoming(at: now).first else { return "Nothing else today" }
        let time = next.start <= now ? "now" : homeTime.hhmm(next.start)
        return "Next: \(next.title) \(time)"
    }

    // MARK: Storage

    public func save(to cache: ResponseCache) throws {
        let data = try JSONEncoder.snapshot.encode(self)
        cache.store(data, key: String(Self.fileName.dropLast(5)))
    }

    public static func load(from cache: ResponseCache) -> WidgetSnapshot? {
        cache.load(key: String(fileName.dropLast(5))).flatMap { try? JSONDecoder.snapshot.decode(WidgetSnapshot.self, from: $0.data) }
    }
}

// The file stays on the phone: the default (exact) date encoding is fine.
extension JSONEncoder {
    static var snapshot: JSONEncoder { JSONEncoder() }
}

extension JSONDecoder {
    static var snapshot: JSONDecoder { JSONDecoder() }
}

extension WidgetSnapshot {
    /// The widgets' view of the next few days (EXT-1): what the calendar
    /// shows for the chosen people and categories, a school day folded into
    /// one "School" item, cancelled and skipped events left out, and the
    /// server's clash marks.
    public static func build(
        from index: CalendarIndex,
        filters: CalendarFilters,
        homeTime: HomeTime,
        now: Date = .now,
        days: Int = 3
    ) -> WidgetSnapshot {
        let shown = index.shown(filters).filter { !$0.isCancelled && !$0.isSkipped }
        let blocks = SchoolBlock.blocks(shown.filter { !$0.allDay }, homeTime: homeTime)
        var items: [Item] = []
        for date in CalendarDates.days(from: homeTime.localDate(now), count: days) {
            let (allDay, timed) = DayLayout.events(on: date, from: shown, homeTime: homeTime)
            let block = blocks.first { $0.date == date }
            let folded = Set(block?.classes.map(\.id) ?? [])
            for e in allDay where !items.contains(where: { $0.title == e.title && $0.allDay && CalendarDates.string($0.start) == e.allDayDates.first }) {
                let d = e.allDayDates
                guard let start = CalendarDates.date(d.first), let end = CalendarDates.date(d.lastExclusive) else { continue }
                items.append(item(e, start: start, end: end, allDay: true, index: index, filters: filters))
            }
            for e in timed where !folded.contains(e.id) {
                guard let start = e.startDate, let end = e.endDate else { continue }
                items.append(item(e, start: start, end: end, allDay: false, index: index, filters: filters))
            }
            if let block, let start = HomeTime.parse(block.start), let end = HomeTime.parse(block.end) {
                items.append(Item(
                    title: "School", symbol: EventCategory.schoolClass.symbol, category: EventCategory.schoolClass.rawValue,
                    start: start, end: end, allDay: false,
                    clash: index.mark(for: block.classes.map(\.id), filters: filters) != .none, place: nil
                ))
            }
        }
        return WidgetSnapshot(generatedAt: now, timeZone: homeTime.timeZone.identifier, items: items)
    }

    private static func item(_ e: CalendarEvent, start: Date, end: Date, allDay: Bool, index: CalendarIndex, filters: CalendarFilters) -> Item {
        Item(title: e.title, symbol: e.category.symbol, category: e.category.rawValue, start: start, end: end,
             allDay: allDay, clash: index.mark(for: [e.id], filters: filters) != .none, place: e.locationName)
    }
}
