import Foundation

/// Where the app talks to and who it says it is (intent 0004, API-6).
public struct HubConfig: Sendable, Equatable {
    public var baseURL: URL
    /// Sent as `X-App-Version`; the server answers 426 below its minimum.
    public var appVersion: String
    /// The phone's name, shown in Settings → Sessions on the site.
    public var deviceName: String

    public static let productionURL = URL(string: "https://jaydenguo.com")!

    public init(baseURL: URL = HubConfig.productionURL, appVersion: String, deviceName: String) {
        self.baseURL = baseURL
        self.appVersion = appVersion
        self.deviceName = deviceName
    }

    /// Development builds can point at a local server with the
    /// `HUB_BASE_URL` environment variable or `-HubBaseURL <url>` launch
    /// argument (UI tests use this); release builds always use production.
    public static func resolved(
        appVersion: String,
        deviceName: String,
        environment: [String: String] = ProcessInfo.processInfo.environment,
        arguments: [String] = ProcessInfo.processInfo.arguments,
        allowOverride: Bool
    ) -> HubConfig {
        var url = productionURL
        if allowOverride {
            let fromArgs = arguments.firstIndex(of: "-HubBaseURL").flatMap { i in
                arguments.indices.contains(i + 1) ? arguments[i + 1] : nil
            }
            if let raw = fromArgs ?? environment["HUB_BASE_URL"], let override = URL(string: raw),
               override.scheme == "http" || override.scheme == "https" {
                url = override
            }
        }
        return HubConfig(baseURL: url, appVersion: appVersion, deviceName: deviceName)
    }
}
