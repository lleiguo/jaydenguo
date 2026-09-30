import Foundation
import Testing
@testable import HubKit

/// Tennis and swimming helpers (intent 0004, plan N4) against the seed's
/// recorded responses.
@Suite struct TennisTests {
    let client = testClient()

    @Test func nextMatchLineNamesTheOpponentAndTime() async throws {
        let overview = try await client.api.getTennisOverview().ok.body.json
        let next = try #require(overview.nextMatches.first)
        let line = try #require(next.draw.nextMatch).line
        #expect(line.hasPrefix("Next: Round of 16 vs Morgan Vale · "))
        #expect(line.hasSuffix(" 10:30"))
        #expect(next.draw.placeLine == "line 5 of 16 · seed 3")
        #expect(next.draw.title == "U12 Boys Singles · Main draw")
    }

    @Test func upcomingStatusAndFoundEntries() async throws {
        let overview = try await client.api.getTennisOverview().ok.body.json
        let row = try #require(overview.upcomingRows.first)
        #expect(row.status.kind == "main_draw")
        #expect(row.status.label == "Main draw")
        #expect(row.status.action == nil)
        #expect(overview.found.first?.status == "found")
    }

    @Test func otherDrawStates() {
        #expect(NextMatch.won.line == "Won the draw 🏆")
        #expect(NextMatch.next(round: "Final", opponent: nil, feeders: ["A", "B"], date: nil, time: nil).line
            == "Next: Final vs winner of A vs B")
        #expect(NextMatch.next(round: "Final", opponent: nil, feeders: nil, date: "2026-10-11", time: nil).line
            == "Next: Final vs opponent to be decided · 2026-10-11")
    }

    @Test func scoresFromEachSide() {
        let sets = [(6, 3), (4, 6), (10, 8)]
        #expect(TennisFormat.score(sets, side: 1) == "6–3 4–6 [10–8]")
        #expect(TennisFormat.score(sets, side: 2) == "3–6 6–4 [8–10]")
        #expect(TennisFormat.editableScore(sets, side: 1) == "6-3 4-6 10-8")
        #expect(TennisFormat.score([(7, 5), (6, 7), (6, 4)], side: 1) == "7–5 6–7 6–4")
    }

    @Test func resultsHaveARunningRecordAndDecodedSets() async throws {
        let results = try await client.api.listTennisResults().ok.body.json
        let row = try #require(results.rows.first)
        #expect(["W", "L"].contains(row.view.resultLetter))
        #expect(TennisFormat.sets(row.match.sets).count >= 2)
        #expect(results.total.wins + results.total.losses == Double(results.rows.count))
    }

    @Test func playerPageHasHeadToHead() async throws {
        let player = try await client.api.getTennisPlayer(path: .init(key: "92002")).ok.body.json
        #expect(player.player.name == "Morgan Vale")
        #expect(!player.h2h.meetings.isEmpty)
        #expect(player.prediction != nil)
    }
}

@Suite struct SwimTests {
    let client = testClient()

    @Test func timesAsTheWebShowsThem() {
        #expect(SwimFormat.time(62_350) == "1:02.35")
        #expect(SwimFormat.time(32_100) == "32.10")
        #expect(SwimFormat.time(605_000) == "10:05.00")
        #expect(SwimFormat.time(nil) == "—")
        #expect(SwimFormat.change(-1230) == "−1.23")
        #expect(SwimFormat.change(450) == "+0.45")
        #expect(SwimFormat.change(0) == "±0.00")
    }

    @Test func eventLabelsAndSessions() {
        #expect(SwimFormat.event(distance: 200, stroke: "im", course: "SCM") == "200 IM SCM")
        #expect(SwimFormat.event(distance: 50, stroke: "free") == "50 Free")
        #expect(SwimFormat.session(date: "2026-10-17", time: "08:30").hasSuffix("2026-10-17 08:30"))
    }

    @Test func eventDetailHasAnEstimate() async throws {
        let detail = try await client.api.getSwimEvent(path: .init(key: "x")).ok.body.json
        #expect(!detail.points.isEmpty)
        if let estimate = detail.estimate {
            #expect(estimate.points.allSatisfy { $0.lowMs <= $0.timeMs && $0.timeMs <= $0.highMs })
        } else {
            #expect(detail.noEstimateReason != nil)
        }
    }
}

/// `patch` and `post` send explicit nulls, which the generated client can't.
/// One serialized suite: they share the stub's state.
@Suite(.serialized) struct PatchTests {
    @Test func sendsNullsAndTheToken() async throws {
        let client = testClient()
        let session = StubProtocol.session(status: 204)
        try await client.patch("/api/v1/swim/results/abc", ["time": .string("1:02.35"), "place": .null, "dqReason": .text("  ")], session: session)
        let request = try #require(StubProtocol.last)
        #expect(request.httpMethod == "PATCH")
        #expect(request.url?.absoluteString == "https://hub.example/api/v1/swim/results/abc")
        #expect(request.value(forHTTPHeaderField: "Authorization")?.hasPrefix("Bearer ") == true)
        let body = try #require(StubProtocol.lastBody)
        #expect(String(decoding: body, as: UTF8.self) == #"{"dqReason":null,"place":null,"time":"1:02.35"}"#)
    }

    @Test func postSendsNullsAndReturnsTheBody() async throws {
        let session = StubProtocol.session(status: 200, body: #"{"eventId":null}"#)
        let data = try await testClient().post("/api/v1/suggestions/s1/approve", ["title": .string("Practice"), "startTime": .null], session: session)
        #expect(String(decoding: data, as: UTF8.self) == #"{"eventId":null}"#)
        #expect(StubProtocol.last?.httpMethod == "POST")
        #expect(String(decoding: try #require(StubProtocol.lastBody), as: UTF8.self) == #"{"startTime":null,"title":"Practice"}"#)
    }

    @Test func downloadsToAProtectedTemporaryFile() async throws {
        let session = StubProtocol.session(status: 200, body: "not really a video")
        let file = try await testClient().download("/api/v1/videos/v1/video", session: session)
        defer { try? FileManager.default.removeItem(at: file) }
        #expect(file.path.hasPrefix(FileManager.default.temporaryDirectory.path))
        #expect(try String(contentsOf: file, encoding: .utf8) == "not really a video")
        #expect(StubProtocol.last?.value(forHTTPHeaderField: "Authorization")?.hasPrefix("Bearer ") == true)
        await #expect(throws: HubError.self) {
            _ = try await testClient().download("/api/v1/videos/v1/video", session: StubProtocol.session(status: 404))
        }
    }

    @Test func refusesOtherPathsAndReportsErrors() async throws {
        let client = testClient()
        await #expect(throws: HubError.self) { try await client.patch("https://evil.example/x", [:]) }
        let session = StubProtocol.session(status: 400, body: #"{"error":"Write the time like 1:02.35."}"#)
        do {
            try await client.patch("/api/v1/swim/results/abc", ["time": .string("x")], session: session)
            Issue.record("expected an error")
        } catch let error as HubError {
            #expect(error.message == "Write the time like 1:02.35.")
        }
    }
}

final class StubProtocol: URLProtocol, @unchecked Sendable {
    nonisolated(unsafe) static var status = 200
    nonisolated(unsafe) static var body = Data()
    nonisolated(unsafe) static var last: URLRequest?
    nonisolated(unsafe) static var lastBody: Data?

    static func session(status: Int, body: String = "") -> URLSession {
        self.status = status
        self.body = Data(body.utf8)
        let config = URLSessionConfiguration.ephemeral
        config.protocolClasses = [StubProtocol.self]
        return URLSession(configuration: config)
    }

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        StubProtocol.last = request
        StubProtocol.lastBody = request.httpBody ?? request.httpBodyStream.map { stream in
            stream.open()
            defer { stream.close() }
            var data = Data()
            var buffer = [UInt8](repeating: 0, count: 4096)
            while stream.hasBytesAvailable {
                let n = stream.read(&buffer, maxLength: buffer.count)
                if n <= 0 { break }
                data.append(buffer, count: n)
            }
            return data
        }
        let response = HTTPURLResponse(url: request.url!, statusCode: StubProtocol.status, httpVersion: nil, headerFields: nil)!
        client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
        client?.urlProtocol(self, didLoad: StubProtocol.body)
        client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {}
}
