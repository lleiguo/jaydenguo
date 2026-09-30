import BackgroundTasks
import Foundation
import HubAPI
import HubKit
import Observation
import UIKit
import WidgetKit

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
    /// The Tennis and Swimming stacks, so links can open a page in them.
    var tennisPath: [Route] = []
    var swimmingPath: [Route] = []
    var morePath: [Route] = []
    /// Source kinds being refreshed from a sport screen (APP-7).
    private(set) var refreshing: Set<String> = []
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
    /// Set while screens show cached answers: when they were fetched (OFF-1).
    private(set) var offlineSince: Date?
    private var widgetItems: [WidgetSnapshot.Item]?
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
        let cache = ResponseCache.shared(appGroup: ResponseCache.bundleAppGroup)
        let client = HubClient(config: config, tokens: tokens, cache: cache, onEvent: { continuation.yield($0) })
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
        // The client already removed the token and the offline cache (SEC-3).
        widgetItems = nil
        offlineSince = nil
        WidgetCenter.shared.reloadAllTimelines()
        email = nil
        cursor = nil
        openClashes = 0
        toast = nil
        selectedTab = .today
        tennisPath = []
        swimmingPath = []
        morePath = []
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
        case .offline(let since):
            // The oldest answer on screen is the one to own up to.
            offlineSince = min(offlineSince ?? since, since)
        case .online:
            if offlineSince != nil { offlineSince = nil }
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

    /// Settings → General: every time follows the new zone (CAL-9).
    func setHomeTimeZone(_ zone: String) async {
        do {
            let saved = try await client.api.updateSettings(body: .json(.init(homeTimeZone: zone))).ok.body.json
            homeTime = HomeTime(identifier: saved.homeTimeZone)
            show("Times are now in \(saved.homeTimeZone).")
        } catch {
            show(HubError.from(error)?.message ?? "Couldn't change the time zone.")
        }
        await dataChanged()
    }

    // MARK: Links

    func open(_ url: URL) {
        guard let route = Route(url: url) else { return }
        go(route)
    }

    /// Opens a page in its tab (links, Today's cards).
    func go(_ route: Route) {
        selectedTab = route.tab
        switch route {
        case .tennis: tennisPath = []
        case .tournament, .player, .tennisResults, .tennisAccuracy: tennisPath = [route]
        case .swimming: swimmingPath = []
        case .meet, .swimEvent: swimmingPath = [route]
        case .school, .suggestions, .sources, .accounts, .settings, .videos: morePath = [route]
        case .video: morePath = [.videos, route]
        default: pendingRoute = route
        }
    }

    // MARK: Widgets (EXT-1, EXT-2)

    /// Writes what the widgets show and asks them to redraw, when it changed.
    func saveWidgets(_ index: CalendarIndex, filters: CalendarFilters) {
        guard phase == .signedIn, let cache = client.cache else { return }
        let snapshot = WidgetSnapshot.build(from: index, filters: filters, homeTime: homeTime)
        guard snapshot.items != widgetItems || WidgetSnapshot.load(from: cache) == nil else { return }
        try? snapshot.save(to: cache)
        widgetItems = snapshot.items
        WidgetCenter.shared.reloadAllTimelines()
    }

    static let refreshTaskID = "com.jaydenguo.hub.refresh"

    /// Asks iOS for a background refresh in about an hour (EXT-2).
    func scheduleRefresh() {
        guard phase == .signedIn else { return }
        let request = BGAppRefreshTaskRequest(identifier: Self.refreshTaskID)
        request.earliestBeginDate = .now.addingTimeInterval(60 * 60)
        try? BGTaskScheduler.shared.submit(request)
    }

    /// Background app refresh: fetch the next days (which also refreshes
    /// the offline copy) and redraw the widgets.
    func refreshInBackground() async {
        scheduleRefresh()
        guard phase == .signedIn else { return }
        let today = homeTime.localDate(.now)
        guard let from = homeTime.startOfDay(today),
              let to = homeTime.startOfDay(CalendarDates.add(days: 4, to: today)),
              let payload = try? await client.api.listEvents(query: .init(from: from, to: to)).ok.body.json
        else { return }
        _ = try? await client.api.getToday().ok
        saveWidgets(CalendarIndex(payload), filters: CalendarStore.loadFilters())
    }

    // MARK: Refresh (APP-7, SYNC-2)

    /// Syncs the sources of one kind (e.g. `tennis_tc`) and follows along
    /// until they finish. Refusals (SYNC-5) show the server's reason.
    func refreshSources(kind: String, site: String) async {
        guard let sources = try? await client.api.listSources().ok.body.json.sources else {
            show("Couldn't refresh from \(site).")
            return
        }
        let ids = sources.filter { $0.kind == kind }.map(\.id)
        guard !ids.isEmpty else {
            show("Add a \(site) source on the website's Sources page first.")
            return
        }
        await refresh(ids: ids, key: kind, site: site)
    }

    /// Syncs one source (Settings → Sources) and follows it.
    func refreshSource(id: String, name: String) async {
        await refresh(ids: [id], key: id, site: name)
    }

    private func refresh(ids: [String], key: String, site: String) async {
        guard !refreshing.contains(key) else { return }
        refreshing.insert(key)
        defer { refreshing.remove(key) }
        do {
            for id in ids { _ = try await client.api.refreshSource(path: .init(id: id)).accepted }
            show("Refreshing from \(site). This takes a minute or two.")
            try await Task.sleep(for: .seconds(3))
            for _ in 0..<60 {
                let sources = try await client.api.listSources().ok.body.json.sources
                if !sources.contains(where: { ids.contains($0.id) && $0.running }) { break }
                await dataChanged()
                try await Task.sleep(for: .seconds(3))
            }
            show("Updated from \(site).")
        } catch is CancellationError {
            return
        } catch {
            show(HubError.from(error)?.message ?? "Couldn't refresh from \(site).")
        }
        await dataChanged()
    }
}

struct Toast: Identifiable, Equatable {
    let id = UUID()
    let message: String
    let undo: Undo?

    static func == (a: Toast, b: Toast) -> Bool { a.id == b.id }
}
