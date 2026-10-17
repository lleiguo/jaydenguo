import Foundation

/// The last calendar the app loaded (intent 0018, SAV-1..5), kept under one
/// name whatever range it covers, so a new week or a far date still finds
/// it. The calendar shows it first and refreshes behind it. It lives in the
/// offline cache's folder, so it's protected and wiped the same way
/// (SAVSEC-1).
public struct SavedCalendar: Codable, Sendable {
    public static let fileName = "calendar-saved.json"
    static var key: String { String(fileName.dropLast(5)) }

    /// The home-zone dates loaded: `from` up to, not including, `to`.
    public var from: String
    public var to: String
    public var payload: CalendarPayload

    public init(from: String, to: String, payload: CalendarPayload) {
        self.from = from
        self.to = to
        self.payload = payload
    }

    /// Called only with a good answer from the server (SAV-5).
    public func save(to cache: ResponseCache, at date: Date = .now) throws {
        cache.store(try JSONEncoder().encode(self), key: Self.key, at: date)
    }

    /// The saved calendar and when it was fetched.
    public static func load(from cache: ResponseCache) -> (calendar: SavedCalendar, fetchedAt: Date)? {
        guard let hit = cache.load(key: key),
              let calendar = try? JSONDecoder().decode(SavedCalendar.self, from: hit.data)
        else { return nil }
        return (calendar, hit.fetchedAt)
    }
}
