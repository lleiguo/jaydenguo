import Foundation
import HubAPI
import OpenAPIRuntime
import OpenAPIURLSession

/// The app's way to the API (intent 0004, §4.1): the generated client with
/// the device token, plus sign-in and sign-out.
public final class HubClient: Sendable {
    public let config: HubConfig
    /// Generated from openapi.json: one method per operation.
    public let api: Client
    private let tokens: TokenStore

    public init(
        config: HubConfig,
        tokens: TokenStore,
        transport: any ClientTransport = URLSessionTransport(),
        onEvent: @escaping @Sendable (HubEvent) -> Void = { _ in }
    ) {
        self.config = config
        self.tokens = tokens
        api = Client(
            serverURL: config.baseURL,
            // The server sends Date.toISOString(): milliseconds, always.
            configuration: Configuration(dateTranscoder: .iso8601WithFractionalSeconds),
            transport: transport,
            middlewares: [HubMiddleware(tokens: tokens, appVersion: config.appVersion, onEvent: onEvent)]
        )
    }

    public var isSignedIn: Bool { (try? tokens.read()) != nil }

    /// Finishes sign-in with the browser sheet's callback URL.
    public func signIn(callback: URL, request: SignInRequest) async throws {
        let code = try SignInRequest.code(from: callback)
        do {
            let output = try await api.exchangeDeviceCode(body: .json(.init(code: code, verifier: request.pkce.verifier)))
            try tokens.save(try output.created.body.json.token)
        } catch {
            throw HubError.from(error) ?? .server(status: 0, message: "Sign-in didn't finish. Try again.")
        }
    }

    /// Ends the session on the server (best effort) and forgets the token.
    /// The caller also wipes the offline cache and widget data (SEC-3).
    public func signOut() async {
        if isSignedIn { _ = try? await api.signOut() }
        try? tokens.delete()
    }

    /// Forgets the token without calling the server (it was already refused).
    public func forgetToken() {
        try? tokens.delete()
    }

    /// Runs the undo an action returned (CON-3: "Undo" for 10 s). Undos are
    /// relative `/api/v1/…` POSTs; anything else is refused.
    public func perform(_ undo: Undo, session: URLSession = .shared) async throws {
        guard undo.url.hasPrefix("/api/v1/"), !undo.url.contains(".."),
              let url = URL(string: undo.url, relativeTo: config.baseURL)?.absoluteURL,
              url.host() == config.baseURL.host()
        else { throw HubError.server(status: 0, message: "That can't be undone here.") }
        var request = URLRequest(url: url)
        request.httpMethod = undo.method.rawValue
        request.setValue(config.appVersion, forHTTPHeaderField: "X-App-Version")
        if let token = try tokens.read() { request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        if let body = undo.body {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try JSONEncoder().encode(body)
        }
        let (data, response) = try await session.data(for: request)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard (200..<300).contains(status) else {
            let message = (try? JSONDecoder().decode([String: String].self, from: data))?["error"]
            throw HubError.server(status: status, message: message ?? "Couldn't undo that.")
        }
    }
}

public enum HubError: Error, Equatable, Sendable {
    case server(status: Int, message: String)
    case offline

    public var message: String {
        switch self {
        case .server(_, let message): message
        case .offline: "You're offline."
        }
    }

    /// The HubError behind an API call's error (the generated client wraps
    /// what the middleware throws), or `.offline` for a lost connection.
    public static func from(_ error: any Error) -> HubError? {
        if let hub = error as? HubError { return hub }
        if let client = error as? ClientError { return from(client.underlyingError) }
        if let url = error as? URLError,
           [.notConnectedToInternet, .networkConnectionLost, .dataNotAllowed, .timedOut, .cannotConnectToHost].contains(url.code) {
            return .offline
        }
        return nil
    }

    static func defaultMessage(_ status: Int) -> String {
        switch status {
        case 401: "You're not signed in."
        case 404: "That isn't there any more."
        case 409: "That changed on the site. Pull to refresh."
        case 429: "Too many tries. Wait a minute."
        case 500...: "The site had a problem. Try again in a minute."
        default: "That didn't work."
        }
    }
}
