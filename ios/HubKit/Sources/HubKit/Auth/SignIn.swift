import Foundation

/// The app's sign-in (intent 0004, API-1): open `startURL` in
/// ASWebAuthenticationSession with callback scheme `jaydenguohub`, hand the
/// callback URL to `code(from:)`, then swap the code at
/// `POST /api/v1/auth/device` (see `HubClient.signIn`).
public struct SignInRequest: Sendable {
    public static let callbackScheme = "jaydenguohub"

    public let pkce: PKCE
    public let startURL: URL

    public init(config: HubConfig, pkce: PKCE = .random()) {
        self.pkce = pkce
        var components = URLComponents(url: config.baseURL.appending(path: "auth/google/start"), resolvingAgainstBaseURL: false)!
        components.queryItems = [
            URLQueryItem(name: "client", value: "ios"),
            URLQueryItem(name: "challenge", value: pkce.challenge),
            URLQueryItem(name: "device", value: config.deviceName),
        ]
        startURL = components.url!
    }

    /// The single-use code from `jaydenguohub://auth?code=…`, or the reason
    /// sign-in didn't finish.
    public static func code(from callback: URL) throws(SignInError) -> String {
        guard callback.scheme == callbackScheme, callback.host() == "auth",
              let items = URLComponents(url: callback, resolvingAgainstBaseURL: false)?.queryItems
        else { throw .unexpectedCallback }
        if let reason = items.first(where: { $0.name == "error" })?.value { throw SignInError(serverReason: reason) }
        guard let code = items.first(where: { $0.name == "code" })?.value, !code.isEmpty else { throw .unexpectedCallback }
        return code
    }
}

public enum SignInError: Error, Equatable, Sendable {
    case notAuthorised
    case cancelled
    case expired
    case rateLimited
    case failed
    case unexpectedCallback

    init(serverReason: String) {
        switch serverReason {
        case "not_authorised": self = .notAuthorised
        case "cancelled": self = .cancelled
        case "expired": self = .expired
        case "rate_limited": self = .rateLimited
        default: self = .failed
        }
    }

    /// Words the sign-in screen can show as they are.
    public var message: String {
        switch self {
        case .notAuthorised: "This Google account isn't allowed to use the hub."
        case .cancelled: "Sign-in was cancelled."
        case .expired: "Sign-in took too long. Try again."
        case .rateLimited: "Too many tries. Wait a few minutes and try again."
        case .failed, .unexpectedCallback: "Sign-in didn't finish. Try again."
        }
    }
}
