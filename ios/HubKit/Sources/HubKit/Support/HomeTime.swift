import Foundation

/// Times arrive as UTC ISO strings and are shown in the home time zone from
/// `/api/v1/settings` (CAL-9), not the phone's, so a trip doesn't shift
/// Jayden's schedule.
public struct HomeTime: Sendable, Equatable {
    public let timeZone: TimeZone
    public let locale: Locale

    public init(identifier: String, locale: Locale = .current) {
        timeZone = TimeZone(identifier: identifier) ?? .current
        self.locale = locale
    }

    /// Whether the phone is somewhere else, so screens can name the zone.
    public func differs(from phone: TimeZone = .current, at date: Date = .now) -> Bool {
        timeZone.secondsFromGMT(for: date) != phone.secondsFromGMT(for: date)
    }

    public static func parse(_ iso: String) -> Date? {
        (try? Date(iso, strategy: .iso8601.year().month().day().time(includingFractionalSeconds: true)))
            ?? (try? Date(iso, strategy: .iso8601))
    }

    private var calendar: Calendar {
        var c = Calendar(identifier: .gregorian)
        c.timeZone = timeZone
        c.locale = locale
        return c
    }

    /// "5:30 PM" (or "17:30", by the phone's settings).
    public func time(_ date: Date) -> String {
        date.formatted(Date.FormatStyle(date: .omitted, time: .shortened, locale: locale, calendar: calendar, timeZone: timeZone))
    }

    public func time(_ iso: String) -> String { HomeTime.parse(iso).map(time) ?? iso }

    /// "Tuesday, 29 September, 5:30 PM" for an instant, in the home zone.
    public func dayAndTime(_ iso: String) -> String {
        guard let d = HomeTime.parse(iso) else { return iso }
        return "\(dayTitle(localDate(d))), \(time(d))"
    }

    /// "17:30" in the home zone: the form the API takes for a time of day.
    public func hhmm(_ date: Date) -> String {
        let c = calendar.dateComponents([.hour, .minute], from: date)
        return String(format: "%02d:%02d", c.hour!, c.minute!)
    }

    /// A time of day on a home date as an instant (for time pickers).
    public func date(_ localDate: String, hhmm: String) -> Date? {
        let t = hhmm.split(separator: ":").compactMap { Int($0) }
        guard t.count == 2, let day = startOfDay(localDate) else { return nil }
        return calendar.date(bySettingHour: t[0], minute: t[1], second: 0, of: day)
    }

    /// "5:30 – 6:30 PM"-style range.
    public func range(_ start: String, _ end: String) -> String {
        guard let s = HomeTime.parse(start), let e = HomeTime.parse(end) else { return "\(start) – \(end)" }
        return range(s, e)
    }

    public func range(_ start: Date, _ end: Date) -> String {
        (start..<max(end, start)).formatted(
            Date.IntervalFormatStyle(date: .omitted, time: .shortened, locale: locale, calendar: calendar, timeZone: timeZone)
        )
    }

    /// The home date ("2026-09-29") of an instant.
    public func localDate(_ date: Date) -> String {
        let c = calendar.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", c.year!, c.month!, c.day!)
    }

    /// Midnight at the start of a home date.
    public func startOfDay(_ localDate: String) -> Date? {
        let parts = localDate.split(separator: "-").compactMap { Int($0) }
        guard parts.count == 3 else { return nil }
        return calendar.date(from: DateComponents(year: parts[0], month: parts[1], day: parts[2]))
    }

    /// "Tuesday, 29 September" for a home date.
    public func dayTitle(_ localDate: String) -> String {
        guard let d = startOfDay(localDate) else { return localDate }
        return d.formatted(
            Date.FormatStyle(locale: locale, calendar: calendar, timeZone: timeZone).weekday(.wide).day().month(.wide)
        )
    }
}
