import Foundation
import HTTPTypes
import OpenAPIRuntime

/// Keeps the last answer to every GET and serves it when there's no
/// connection (OFF-1), telling the app how old it is. Writes are never
/// queued: offline they fail with "You're offline" (OFF-2).
struct CacheMiddleware: ClientMiddleware {
    let cache: ResponseCache
    let onEvent: @Sendable (HubEvent) -> Void

    /// Live-only answers: the change feed must never replay an old cursor,
    /// and nothing from Cookie is kept on the phone (intent 0007, CSEC-8).
    static let liveOnly: Set<String> = [
        "getChanges", "listAssistantTurns", "getAssistantSettings", "listAssistantMemories", "getAssistantSpeech",
    ]
    /// Kept by the app itself: the calendar saves its last load under one
    /// name (intent 0018, SAV-4), so an old copy is never replayed as new.
    static let savedByTheApp: Set<String> = ["listEvents"]
    static let cachedAtField = HTTPField.Name("X-Hub-Cached-At")!

    func intercept(
        _ request: HTTPRequest,
        body: HTTPBody?,
        baseURL: URL,
        operationID: String,
        next: @Sendable (HTTPRequest, HTTPBody?, URL) async throws -> (HTTPResponse, HTTPBody?)
    ) async throws -> (HTTPResponse, HTTPBody?) {
        let cacheable = request.method == .get && !Self.liveOnly.contains(operationID) && !Self.savedByTheApp.contains(operationID)
        let key = ResponseCache.key(path: request.path ?? operationID)
        let response: HTTPResponse, responseBody: HTTPBody?
        do {
            (response, responseBody) = try await next(request, body, baseURL)
        } catch where Self.isOffline(error) {
            guard cacheable, let hit = cache.load(key: key) else { throw HubError.offline }
            onEvent(.offline(since: hit.fetchedAt))
            var cached = HTTPResponse(status: .ok)
            cached.headerFields[.contentType] = "application/json"
            cached.headerFields[Self.cachedAtField] = ISO8601DateFormatter().string(from: hit.fetchedAt)
            return (cached, HTTPBody(hit.data))
        }
        onEvent(.online)
        guard cacheable, response.status == .ok,
              response.headerFields[.contentType]?.hasPrefix("application/json") == true,
              let responseBody
        else { return (response, responseBody) }
        let data = try await Data(collecting: responseBody, upTo: 16 * 1024 * 1024)
        cache.store(data, key: key)
        return (response, HTTPBody(data))
    }

    static func isOffline(_ error: any Error) -> Bool {
        HubError.from(error) == .offline
    }
}
