import Foundation
import Testing
@testable import HubKit

@Suite struct PKCETests {
    // RFC 7636 appendix B.
    @Test func matchesTheRFCExample() {
        let pkce = PKCE(verifier: "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")
        #expect(pkce.challenge == "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM")
    }

    @Test func randomVerifiersAreWellFormedAndDifferent() {
        let a = PKCE.random(), b = PKCE.random()
        #expect(a.verifier.count == 43)
        #expect(a.verifier.range(of: "^[A-Za-z0-9_-]{43}$", options: .regularExpression) != nil)
        #expect(a != b)
    }
}

@Suite struct SignInTests {
    let config = HubConfig(baseURL: URL(string: "https://hub.example")!, appVersion: "1", deviceName: "Lei’s iPhone")

    @Test func startURLCarriesTheChallengeAndDevice() throws {
        let request = SignInRequest(config: config, pkce: PKCE(verifier: String(repeating: "v", count: 43)))
        let c = try #require(URLComponents(url: request.startURL, resolvingAgainstBaseURL: false))
        #expect(c.path == "/auth/google/start")
        let q = Dictionary(uniqueKeysWithValues: (c.queryItems ?? []).map { ($0.name, $0.value ?? "") })
        #expect(q == ["client": "ios", "challenge": request.pkce.challenge, "device": "Lei’s iPhone"])
    }

    @Test func readsTheCodeOrTheReason() throws {
        #expect(try SignInRequest.code(from: URL(string: "jaydenguohub://auth?code=abc")!) == "abc")
        #expect(throws: SignInError.notAuthorised) { try SignInRequest.code(from: URL(string: "jaydenguohub://auth?error=not_authorised")!) }
        #expect(throws: SignInError.failed) { try SignInRequest.code(from: URL(string: "jaydenguohub://auth?error=whatever")!) }
        #expect(throws: SignInError.unexpectedCallback) { try SignInRequest.code(from: URL(string: "https://evil.example/auth?code=abc")!) }
        #expect(throws: SignInError.unexpectedCallback) { try SignInRequest.code(from: URL(string: "jaydenguohub://done?code=abc")!) }
    }

    @Test func exchangesTheCodeAndKeepsTheToken() async throws {
        let transport = FixtureTransport()
        transport.status = .created
        transport.bodyOverride = #"{"token":"\#(String(repeating: "k", count: 43))","expiresAt":"2026-10-29T00:00:00.000Z"}"#
        let client = testClient(token: nil, transport: transport)
        let request = SignInRequest(config: config)
        try await client.signIn(callback: URL(string: "jaydenguohub://auth?code=abc")!, request: request)
        #expect(client.isSignedIn)
        #expect(transport.requests.first?.operationID == "exchangeDeviceCode")
    }

    @Test func aRefusedExchangeSaysWhy() async throws {
        let transport = FixtureTransport()
        transport.status = .unauthorized
        transport.bodyOverride = #"{"error":"Sign-in didn't finish. Try again."}"#
        let events = EventLog()
        let client = testClient(token: nil, transport: transport, events: events)
        await #expect(throws: HubError.server(status: 401, message: "Sign-in didn't finish. Try again.")) {
            try await client.signIn(callback: URL(string: "jaydenguohub://auth?code=abc")!, request: SignInRequest(config: config))
        }
        #expect(!client.isSignedIn)
        #expect(events.all.isEmpty, "a failed sign-in isn't a sign-out")
    }
}

@Suite struct MiddlewareTests {
    @Test func sendsTheTokenAndVersion() async throws {
        let transport = FixtureTransport()
        _ = try await testClient(transport: transport).api.getMe()
        let request = try #require(transport.requests.first?.request)
        #expect(request.headerFields[.authorization] == "Bearer " + String(repeating: "T", count: 43))
        #expect(request.headerFields[HubMiddleware.appVersionField] == "1.2.3")
    }

    @Test func aRefusedTokenSignsOut() async throws {
        let transport = FixtureTransport()
        transport.status = .unauthorized
        transport.bodyOverride = #"{"error":"unauthorised"}"#
        let events = EventLog()
        _ = try? await testClient(transport: transport, events: events).api.getMe()
        #expect(events.all == [.signedOut])
    }

    @Test func anOldBuildIsAskedToUpdate() async throws {
        let transport = FixtureTransport()
        transport.status = .init(code: 426)
        transport.bodyOverride = #"{"error":"This version of the app is too old."}"#
        let events = EventLog()
        _ = try? await testClient(transport: transport, events: events).api.getMe()
        #expect(events.all == [.updateRequired(message: "This version of the app is too old.")])
    }

    @Test func signOutForgetsTheToken() async {
        let client = testClient()
        await client.signOut()
        #expect(!client.isSignedIn)
    }
}

@Suite struct ConfigTests {
    @Test func releaseBuildsIgnoreOverrides() {
        let c = HubConfig.resolved(appVersion: "1", deviceName: "x", environment: ["HUB_BASE_URL": "http://localhost:3000"], arguments: [], allowOverride: false)
        #expect(c.baseURL == HubConfig.productionURL)
    }

    @Test func developmentBuildsTakeALocalServer() {
        let c = HubConfig.resolved(appVersion: "1", deviceName: "x", environment: [:], arguments: ["app", "-HubBaseURL", "http://localhost:3200"], allowOverride: true)
        #expect(c.baseURL.absoluteString == "http://localhost:3200")
        let bad = HubConfig.resolved(appVersion: "1", deviceName: "x", environment: ["HUB_BASE_URL": "javascript:alert(1)"], arguments: [], allowOverride: true)
        #expect(bad.baseURL == HubConfig.productionURL)
    }
}

@Suite struct UndoTests {
    func undo(_ url: String) -> Undo {
        try! JSONDecoder().decode(Undo.self, from: Data(#"{"method":"POST","url":"\#(url)"}"#.utf8))
    }

    @Test(arguments: ["https://evil.example/api/v1/x", "/auth/signout", "/api/v1/../auth/signout", "//evil.example/api/v1/x"])
    func refusesAnythingButTheSitesAPI(_ url: String) async {
        await #expect(throws: HubError.self) { try await testClient().perform(undo(url)) }
    }
}
