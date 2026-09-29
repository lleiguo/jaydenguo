import Foundation
import HTTPTypes
import OpenAPIRuntime
@testable import HubKit

/// Serves recorded responses by operation id, and remembers what was sent.
final class FixtureTransport: ClientTransport, @unchecked Sendable {
    struct Sent { let request: HTTPRequest; let operationID: String }
    private let lock = NSLock()
    private var sent: [Sent] = []
    var status: HTTPResponse.Status = .ok
    var bodyOverride: String?
    /// Thrown instead of answering, e.g. URLError(.notConnectedToInternet).
    var failure: (any Error)?

    var requests: [Sent] { lock.withLock { sent } }

    func send(_ request: HTTPRequest, body: HTTPBody?, baseURL: URL, operationID: String) async throws -> (HTTPResponse, HTTPBody?) {
        lock.withLock { sent.append(Sent(request: request, operationID: operationID)) }
        if let failure { throw failure }
        let data: Data
        if let bodyOverride {
            data = Data(bodyOverride.utf8)
        } else {
            data = try Fixtures.data(operationID)
        }
        var response = HTTPResponse(status: status)
        response.headerFields[.contentType] = "application/json"
        return (response, HTTPBody(data))
    }
}

enum Fixtures {
    static func data(_ operationID: String) throws -> Data {
        guard let url = Bundle.module.url(forResource: operationID, withExtension: "json", subdirectory: "Fixtures") else {
            throw CocoaError(.fileNoSuchFile, userInfo: [NSFilePathErrorKey: "\(operationID).json"])
        }
        return try Data(contentsOf: url)
    }

    static var all: [String] {
        (Bundle.module.urls(forResourcesWithExtension: "json", subdirectory: "Fixtures") ?? [])
            .map { $0.deletingPathExtension().lastPathComponent }
            .sorted()
    }
}

func testClient(token: String? = "T".padding(toLength: 43, withPad: "T", startingAt: 0), transport: FixtureTransport = FixtureTransport(), cache: ResponseCache? = nil, events: EventLog = EventLog()) -> HubClient {
    HubClient(
        config: HubConfig(baseURL: URL(string: "https://hub.example")!, appVersion: "1.2.3", deviceName: "Test iPhone"),
        tokens: MemoryTokenStore(token: token),
        transport: transport,
        cache: cache,
        onEvent: { events.append($0) }
    )
}

/// A cache in a fresh temporary folder.
func temporaryCache(limit: Int = 300) -> ResponseCache {
    ResponseCache(directory: FileManager.default.temporaryDirectory.appendingPathComponent("hubcache-\(UUID().uuidString)"), limit: limit)
}

final class EventLog: @unchecked Sendable {
    private let lock = NSLock()
    private var events: [HubEvent] = []
    func append(_ e: HubEvent) { lock.withLock { events.append(e) } }
    var all: [HubEvent] { lock.withLock { events } }
}
