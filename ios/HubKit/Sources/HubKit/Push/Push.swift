import Foundation
import HubAPI

/// Push notifications (intent 0004, PUSH-2..4): what the app, its
/// notification extension and the settings screen share.
public enum Push {
    /// APNs tokens go to the server as lowercase hex.
    public static func hex(_ token: Data) -> String {
        token.map { String(format: "%02x", $0) }.joined()
    }

    /// Development builds are signed for Apple's sandbox; TestFlight and
    /// App Store builds for production.
    public static var environment: String {
        #if DEBUG
        "sandbox"
        #else
        "production"
        #endif
    }

    /// The notification's id and kind, the only things Apple carries (PUSH-2).
    public static func id(from userInfo: [AnyHashable: Any]) -> String? {
        userInfo["id"] as? String
    }

    /// Where a tap goes (PUSH-4): the target the extension saved, as a link
    /// the app already knows.
    public static func route(target: String) -> Route? {
        URL(string: "jaydenguohub://open/\(target)").flatMap { Route(url: $0) }
    }

    /// A clash push targets its first event (so older builds open that);
    /// this build opens the clash itself (intent 0023, NTF-C2).
    public static func route(target: String, kind: String?) -> Route? {
        let route = route(target: target)
        if kind == "clash", case .event(let id) = route { return .clash(eventId: id) }
        return route
    }

    public typealias Text = Components.Schemas.NotificationView

    /// Fetches the text with the device token. Nil when it can't (offline,
    /// signed out): the generic text stays.
    public static func text(id: String, client: HubClient) async -> Text? {
        try? await client.api.getNotification(path: .init(id: id)).ok.body.json
    }
}

/// Settings the app shares with its extensions through the app group:
/// which server to talk to (development builds can point at a local one).
public struct SharedSettings {
    public let defaults: UserDefaults?

    public init(appGroup: String?) {
        defaults = appGroup.flatMap { UserDefaults(suiteName: $0) }
    }

    public var baseURL: URL? {
        get { defaults?.string(forKey: "HubBaseURL").flatMap(URL.init(string:)) }
        nonmutating set { defaults?.set(newValue?.absoluteString, forKey: "HubBaseURL") }
    }

    /// A Google Photos video shared to the hub (EXT-3): the share sheet
    /// can't pick it, so it leaves the note here and the app opens the
    /// picker with it.
    public var pendingPhotosReview: PendingReview? {
        get { defaults?.data(forKey: "PendingPhotosReview").flatMap { try? JSONDecoder().decode(PendingReview.self, from: $0) } }
        nonmutating set { defaults?.set(newValue.flatMap { try? JSONEncoder().encode($0) }, forKey: "PendingPhotosReview") }
    }
}

public struct PendingReview: Codable, Sendable, Equatable {
    public var sport: String
    public var note: String
    /// yyyy-MM-dd.
    public var filmedOn: String

    public init(sport: String, note: String, filmedOn: String) {
        self.sport = sport
        self.note = note
        self.filmedOn = filmedOn
    }
}

/// A client for the app's extensions and Shortcuts: the device token and
/// server the app keeps in the app group.
public enum SharedClient {
    public static func make(deviceName: String, bundle: Bundle = .main, cache: ResponseCache? = nil) -> HubClient {
        let group = ResponseCache.bundleAppGroup
        let config = HubConfig(
            baseURL: SharedSettings(appGroup: group).baseURL ?? HubConfig.productionURL,
            appVersion: bundle.infoDictionary?["CFBundleShortVersionString"] as? String ?? "0",
            deviceName: deviceName
        )
        return HubClient(config: config, tokens: KeychainTokenStore(accessGroup: group), cache: cache)
    }
}
