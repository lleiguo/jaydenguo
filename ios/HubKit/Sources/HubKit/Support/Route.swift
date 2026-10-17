import Foundation

/// Where a link opens in the app (intent 0004, PUSH-4, EXT-1): links to the
/// site's pages (from notifications, widgets or shared links) and the app's
/// own `jaydenguohub://open/<page>` links map to the same screens.
public enum Route: Equatable, Sendable, Hashable {
    case today
    case calendar(date: String?)
    case event(id: String)
    case clashes
    case tennis
    case tournament(id: String)
    /// One upcoming entry and its acceptance list (intent 0017, ACC-5).
    case tennisEntry(id: String)
    case player(key: String)
    case tennisResults
    case tennisAccuracy
    case swimming
    case meet(id: String)
    case swimEvent(key: String)
    case videos
    case video(id: String)
    case school
    case suggestions
    case sources
    case accounts
    case settings
    /// Settings → App → Notifications (PUSH-3).
    case notifications
    /// The chat with Cookie: where her follow-up answers land (intent 0009, ERA-3).
    case cookie

    public init?(url: URL, siteHost: String = "jaydenguo.com") {
        let parts: [String]
        switch url.scheme {
        case "jaydenguohub" where url.host() == "open":
            parts = url.pathComponents.filter { $0 != "/" }
        case "https" where url.host() == siteHost:
            parts = url.pathComponents.filter { $0 != "/" }
        default:
            return nil
        }
        let query = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []
        let at = { (i: Int) in parts.indices.contains(i) ? parts[i] : nil }
        switch (parts.count, at(0), at(1), at(2)) {
        case (0, _, _, _), (1, "today", _, _): self = .today
        case (1, "calendar", _, _): self = .calendar(date: query.first { $0.name == "date" }?.value)
        case (2, "events", let id?, _): self = .event(id: id)
        case (1, "clashes", _, _), (2, "settings", "clashes", _): self = .clashes
        case (1, "tennis", _, _): self = .tennis
        case (3, "tennis", "tournaments", let id?): self = .tournament(id: id)
        case (3, "tennis", "entries", let id?): self = .tennisEntry(id: id)
        case (3, "tennis", "players", let key?): self = .player(key: key)
        case (2, "tennis", "results", _): self = .tennisResults
        case (2, "tennis", "accuracy", _): self = .tennisAccuracy
        case (1, "swimming", _, _): self = .swimming
        case (3, "swimming", "meets", let id?): self = .meet(id: id)
        case (3, "swimming", "events", let key?): self = .swimEvent(key: key)
        case (1, "videos", _, _): self = .videos
        case (2, "videos", let id?, _): self = .video(id: id)
        case (1, "school", _, _): self = .school
        case (1, "suggestions", _, _), (2, "settings", "suggestions", _): self = .suggestions
        case (1, "sources", _, _), (2, "settings", "sources", _): self = .sources
        case (1, "accounts", _, _), (2, "settings", "accounts", _): self = .accounts
        case (2, "settings", "notifications", _): self = .notifications
        case (1, "cookie", _, _): self = .cookie
        case (1, "settings", _, _): self = .settings
        default: return nil
        }
    }

    /// The tab a route belongs to.
    public var tab: Tab {
        switch self {
        case .today, .cookie: .today
        case .calendar, .event, .clashes: .calendar
        case .tennis, .tournament, .tennisEntry, .player, .tennisResults, .tennisAccuracy: .tennis
        case .swimming, .meet, .swimEvent: .swimming
        case .videos, .video, .school, .suggestions, .sources, .accounts, .settings, .notifications: .more
        }
    }

    public enum Tab: String, CaseIterable, Sendable, Hashable {
        case today, calendar, tennis, swimming, more
    }
}
