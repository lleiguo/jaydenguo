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
        let output = try await api.exchangeDeviceCode(body: .json(.init(code: code, verifier: request.pkce.verifier)))
        switch output {
        case .created(let created):
            try tokens.save(try created.body.json.token)
        case .default(let status, let failure):
            throw HubError.server(status: status, message: (try? failure.body.json.error) ?? "Sign-in didn't finish.")
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
}
