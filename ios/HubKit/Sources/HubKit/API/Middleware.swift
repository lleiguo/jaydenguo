import Foundation
import HTTPTypes
import OpenAPIRuntime

/// What the app must react to from any API call.
public enum HubEvent: Sendable, Equatable {
    /// The token was refused (revoked by "Sign out everywhere", expired, or
    /// the account left the allow-list): wipe and show sign-in (SEC-3).
    case signedOut
    /// This build is too old (426, API-6).
    case updateRequired(message: String)
}

/// Adds `Authorization: Bearer` and `X-App-Version` (API-2, API-6), reports
/// 401 and 426 responses, and turns every error response into a HubError.
struct HubMiddleware: ClientMiddleware {
    let tokens: TokenStore
    let appVersion: String
    let onEvent: @Sendable (HubEvent) -> Void

    static let appVersionField = HTTPField.Name("X-App-Version")!

    func intercept(
        _ request: HTTPRequest,
        body: HTTPBody?,
        baseURL: URL,
        operationID: String,
        next: @Sendable (HTTPRequest, HTTPBody?, URL) async throws -> (HTTPResponse, HTTPBody?)
    ) async throws -> (HTTPResponse, HTTPBody?) {
        var request = request
        request.headerFields[Self.appVersionField] = appVersion
        let token = try tokens.read()
        if let token { request.headerFields[.authorization] = "Bearer \(token)" }
        let (response, responseBody) = try await next(request, body, baseURL)
        let status = response.status.code
        guard status >= 400 else { return (response, responseBody) }
        // Every error becomes a HubError with the server's own words.
        let message = (try? await ErrorBody.message(from: responseBody)) ?? nil
        switch status {
        case 401 where token != nil && operationID != "exchangeDeviceCode":
            onEvent(.signedOut)
        case 426:
            onEvent(.updateRequired(message: message ?? "This version of the app is too old."))
        default:
            break
        }
        throw HubError.server(status: status, message: message ?? HubError.defaultMessage(status))
    }
}

enum ErrorBody {
    static func message(from body: HTTPBody?) async throws -> String? {
        guard let body else { return nil }
        let data = try await Data(collecting: body, upTo: 64 * 1024)
        return (try? JSONDecoder().decode([String: String].self, from: data))?["error"]
    }
}
