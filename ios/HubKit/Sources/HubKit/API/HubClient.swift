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
    private let onEvent: @Sendable (HubEvent) -> Void
    /// The offline copy of every GET, shared with the widgets (OFF-1..3).
    public let cache: ResponseCache?

    public init(
        config: HubConfig,
        tokens: TokenStore,
        transport: any ClientTransport = URLSessionTransport(),
        cache: ResponseCache? = nil,
        onEvent: @escaping @Sendable (HubEvent) -> Void = { _ in }
    ) {
        self.config = config
        self.tokens = tokens
        self.onEvent = onEvent
        self.cache = cache
        var middlewares: [any ClientMiddleware] = [HubMiddleware(tokens: tokens, appVersion: config.appVersion, onEvent: onEvent)]
        if let cache { middlewares.append(CacheMiddleware(cache: cache, onEvent: onEvent)) }
        api = Client(
            serverURL: config.baseURL,
            // The server sends Date.toISOString(): milliseconds, always.
            configuration: Configuration(dateTranscoder: .iso8601WithFractionalSeconds),
            transport: transport,
            middlewares: middlewares
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
    public func signOut() async {
        if isSignedIn { _ = try? await api.signOut() }
        forgetToken()
    }

    /// Forgets the token and the offline copy without calling the server
    /// (it was already refused). The caller reloads the widgets (SEC-3).
    public func forgetToken() {
        try? tokens.delete()
        cache?.wipe()
    }

    /// Runs the undo an action returned (CON-3: "Undo" for 10 s). Undos are
    /// relative `/api/v1/…` POSTs; anything else is refused.
    public func perform(_ undo: Undo, session: URLSession = .shared) async throws {
        let body = try undo.body.map { try JSONEncoder().encode($0) }
        _ = try await send(undo.method.rawValue, undo.url, body: body, session: session, fallback: "Couldn't undo that.")
    }

    /// A PATCH whose fields can be cleared. The generated client leaves nil
    /// fields out, which the correction routes (TEN-8, SWM-7) read as
    /// "unchanged"; here `.null` sends an explicit null.
    public func patch(_ path: String, _ fields: [String: JSONField], session: URLSession = .shared) async throws {
        let body = try JSONSerialization.data(withJSONObject: fields.mapValues(\.object), options: [.sortedKeys])
        _ = try await send("PATCH", path, body: body, session: session, fallback: "Couldn't save that.")
    }

    /// A request to a relative `/api/v1/…` path on this server with the
    /// device token, turning errors into HubError like the middleware does.
    private func send(_ method: String, _ path: String, body: Data?, session: URLSession, fallback: String) async throws -> Data {
        guard path.hasPrefix("/api/v1/"), !path.contains(".."),
              let url = URL(string: path, relativeTo: config.baseURL)?.absoluteURL,
              url.host() == config.baseURL.host()
        else { throw HubError.server(status: 0, message: "That can't be done here.") }
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.setValue(config.appVersion, forHTTPHeaderField: "X-App-Version")
        if let token = try tokens.read() { request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        if let body {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = body
        }
        let data: Data, response: URLResponse
        do {
            (data, response) = try await session.data(for: request)
        } catch {
            throw HubError.from(error) ?? HubError.server(status: 0, message: fallback)
        }
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard (200..<300).contains(status) else {
            let message = (try? JSONDecoder().decode([String: String].self, from: data))?["error"] ?? fallback
            if status == 401 { onEvent(.signedOut) }
            if status == 426 { onEvent(.updateRequired(message: message)) }
            throw HubError.server(status: status, message: message)
        }
        return data
    }
}

/// One field of a `patch` body.
public enum JSONField: Sendable, Equatable {
    case string(String)
    case int(Int)
    case bool(Bool)
    case null

    var object: Any {
        switch self {
        case .string(let s): s
        case .int(let i): i
        case .bool(let b): b
        case .null: NSNull()
        }
    }

    /// A string, or null when it's empty after trimming.
    public static func text(_ s: String?) -> JSONField {
        guard let t = s?.trimmingCharacters(in: .whitespacesAndNewlines), !t.isEmpty else { return .null }
        return .string(t)
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
