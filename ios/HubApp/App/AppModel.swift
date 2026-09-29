import Foundation
import HubAPI
import HubKit
import Observation
import UIKit

/// App-wide state (intent 0004, §4.1): whether we're signed in, the home
/// time zone, where links open, and reactions to API events (SEC-3, API-6).
@MainActor @Observable
final class AppModel {
    enum Phase: Equatable {
        case signedOut
        case signedIn
        case updateRequired(String)
    }

    private(set) var phase: Phase
    var selectedTab: Route.Tab = .today
    var pendingRoute: Route?
    var signInError: String?
    var isSigningIn = false
    private(set) var homeTime = HomeTime(identifier: "America/Toronto")
    private(set) var email: String?
    /// Bumped whenever the server's data changed (CAL-8); screens reload.
    private(set) var changes = 0
    /// Open clashes in the next 60 days, for the Calendar tab (CON-2).
    private(set) var openClashes = 0
    /// The 10-second undo banner (CON-3), shared by every screen.
    var toast: Toast?
    private var cursor: Double?

    let client: HubClient
    let lock: AppLock

    init(client: HubClient, events: AsyncStream<HubEvent>, lock: AppLock) {
        self.client = client
        self.lock = lock
        phase = client.isSignedIn ? .signedIn : .signedOut
        Task { [weak self] in
            for await event in events { self?.handle(event) }
        }
        if phase == .signedIn { Task { await loadAccount() } }
    }

    static func live() -> AppModel {
        #if DEBUG
        let debug = true
        #else
        let debug = false
        #endif
        let info = Bundle.main.infoDictionary
        let config = HubConfig.resolved(
            appVersion: info?["CFBundleShortVersionString"] as? String ?? "0",
            deviceName: UIDevice.current.name,
            allowOverride: debug
        )
        let (events, continuation) = AsyncStream<HubEvent>.makeStream()
        let tokens = KeychainTokenStore()
        let arguments = ProcessInfo.processInfo.arguments
        if debug, let i = arguments.firstIndex(of: "-HubUITestToken"), arguments.indices.contains(i + 1) {
            // UI tests sign in with a token from the local server's dev route.
            try? tokens.save(arguments[i + 1])
        }
        let client = HubClient(config: config, tokens: tokens, onEvent: { continuation.yield($0) })
        let lock = AppLock(forceOff: debug && arguments.contains("-HubNoLock"))
        return AppModel(client: client, events: events, lock: lock)
    }

    // MARK: Sign-in

    func signIn(using authenticate: (URL) async throws -> URL) async {
        signInError = nil
        isSigningIn = true
        defer { isSigningIn = false }
        let request = SignInRequest(config: client.config)
        do {
            let callback = try await authenticate(request.startURL)
            try await client.signIn(callback: callback, request: request)
            phase = .signedIn
            lock.didSignIn()
            await loadAccount()
        } catch let error as SignInError {
            if error != .cancelled { signInError = error.message }
        } catch let error as HubError {
            signInError = error.message
        } catch {
            // The user closed the sheet, or the network failed.
            if (error as NSError).code != 1 { signInError = "Sign-in didn't finish. Check your connection and try again." }
        }
    }

    func signOut() async {
        await client.signOut()
        wipe()
    }

    private func wipe() {
        // The offline cache and widget data join this in N5 (SEC-3).
        email = nil
        cursor = nil
        openClashes = 0
        toast = nil
        selectedTab = .today
        phase = .signedOut
    }

    private func handle(_ event: HubEvent) {
        switch event {
        case .signedOut:
            client.forgetToken()
            wipe()
            signInError = "You were signed out. Sign in again."
        case .updateRequired(let message):
            phase = .updateRequired(message)
        }
    }

    // MARK: Live updates (CAL-8, APP-4)

    /// Asks every 10 s whether anything changed, while the app is open.
    func watchChanges() async {
        while !Task.isCancelled, phase == .signedIn {
            await checkForChanges()
            try? await Task.sleep(for: .seconds(10))
        }
    }

    func checkForChanges() async {
        guard let answer = try? await client.api.getChanges(query: .init(since: cursor.map { Int($0) })).ok.body.json else { return }
        let first = cursor == nil
        cursor = answer.cursor
        if answer.changed || first { await dataChanged() }
    }

    /// After this app changed something, or the server says data changed.
    func dataChanged() async {
        changes += 1
        if let clashes = try? await client.api.listClashes().ok.body.json { openClashes = Int(clashes.open) }
    }

    // MARK: Undo (CON-3)

    func show(_ message: String, undo: Undo? = nil) {
        toast = Toast(message: message, undo: undo)
    }

    func runUndo(_ toast: Toast) async {
        guard let undo = toast.undo else { return }
        self.toast = nil
        do {
            try await client.perform(undo)
            show("Undone.")
        } catch let error as HubError {
            show(error.message)
        } catch {
            show("Couldn't undo that.")
        }
        await dataChanged()
    }

    private func loadAccount() async {
        async let me = try? client.api.getMe().ok.body.json
        async let settings = try? client.api.getSettings().ok.body.json
        email = await me?.email
        if let zone = await settings?.homeTimeZone { homeTime = HomeTime(identifier: zone) }
    }

    // MARK: Links

    func open(_ url: URL) {
        guard let route = Route(url: url) else { return }
        selectedTab = route.tab
        pendingRoute = route
    }
}

struct Toast: Identifiable, Equatable {
    let id = UUID()
    let message: String
    let undo: Undo?

    static func == (a: Toast, b: Toast) -> Bool { a.id == b.id }
}
