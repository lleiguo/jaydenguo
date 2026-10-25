import BackgroundTasks
import Foundation
import HubAPI
import HubKit
import Observation
import UIKit
import UserNotifications
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
    /// The home date of an event opened from outside the calendar (one of
    /// Cookie's cards), so the calendar loads its week first.
    var pendingEventDay: String?
    /// The Tennis and Swimming stacks, so links can open a page in them.
    var tennisPath: [Route] = []
    var swimmingPath: [Route] = []
    var morePath: [Route] = []
    /// Today's stack: the mail (intent 0025).
    var todayPath: [Route] = []
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
    /// From the process starting to Today's list first showing (INFR-2),
    /// and how much of it was the app's own code (after the system loaded it).
    private(set) var launchToToday: TimeInterval?
    private(set) var appCodeToToday: TimeInterval?
    /// When the app's code started (the model is made first).
    private static let appStart = Date.now
    /// A Google Photos video shared to the hub, to pick (EXT-3).
    var newReviewDraft: PendingReview?
    /// Shows the "turn on notifications?" explanation (PUSH-3).
    var askForNotifications = false
    /// The chat with Cookie is open (intent 0007, CK-4).
    var cookieOpen = false
    /// Screens that hide Cookie's button while they show: the video
    /// player (CK-1).
    var cookieHiddenBy = 0
    /// This phone's notification kinds, once registered.
    private(set) var notificationSettings: Components.Schemas.DeviceSettings?
    /// Set when iOS can't give this build a push token (a Personal Team
    /// build on a phone).
    private(set) var pushProblem: String?
    private var widgetItems: [WidgetSnapshot.Item]?
    private var cursor: Double?

    let client: HubClient
    let lock: AppLock
    let cookie: CookieStore
    /// Talking to her: recording and speech (plan K6).
    let cookieTalk: CookieTalk
    /// Reading today's mail aloud (intent 0025, MA-1..3).
    let mailPlayer: MailPlayer

    init(client: HubClient, events: AsyncStream<HubEvent>, lock: AppLock) {
        self.client = client
        self.lock = lock
        cookie = CookieStore(client: client)
        cookieTalk = CookieTalk(store: cookie, client: client)
        mailPlayer = MailPlayer(client: client)
        mailPlayer.onRead = { id in
            Task { _ = try? await client.api.markMailRead(path: .init(id: id)).noContent }
        }
        phase = client.isSignedIn ? .signedIn : .signedOut
        cookieTalk.chatOpen = { [weak self] in self?.cookieOpen ?? false }
        Task { [weak self] in
            for await event in events { self?.handle(event) }
        }
        if phase == .signedIn {
            Task {
                await loadAccount()
                await settleNotifications()
            }
        }
    }

    static func live() -> AppModel {
        _ = appStart
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
        // The device token lives in the app group, so the notification
        // extension can fetch a notification's text (PUSH-2).
        let group = ResponseCache.bundleAppGroup
        if let group, !UserDefaults.standard.bool(forKey: "tokenInAppGroup") {
            try? KeychainTokenStore.moveIntoGroup(group)
            UserDefaults.standard.set(true, forKey: "tokenInAppGroup")
        }
        let tokens = KeychainTokenStore(accessGroup: group)
        let arguments = ProcessInfo.processInfo.arguments
        if debug, let i = arguments.firstIndex(of: "-HubUITestToken"), arguments.indices.contains(i + 1) {
            // UI tests sign in with a token from the local server's dev route.
            try? tokens.save(arguments[i + 1])
        }
        let cache = ResponseCache.shared(appGroup: ResponseCache.bundleAppGroup)
        let client = HubClient(config: config, tokens: tokens, cache: cache, onEvent: { continuation.yield($0) })
        let lock = AppLock(forceOff: debug && arguments.contains("-HubNoLock"))
        SharedSettings(appGroup: group).baseURL = config.baseURL
        let model = AppModel(client: client, events: events, lock: lock)
        AppDelegate.model = model
        return model
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
            await settleNotifications()
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
        cookieTalk.reset()
        cookie.reset()
        mailPlayer.reset()
        cookieOpen = false
        widgetItems = nil
        offlineSince = nil
        WidgetCenter.shared.reloadAllTimelines()
        email = nil
        cursor = nil
        openClashes = 0
        toast = nil
        notificationSettings = nil
        askForNotifications = false
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

    /// A screen is showing what it saved earlier, because the server is slow
    /// or out of reach (intent 0018, SAV-3).
    func showingSaved(since: Date) {
        handle(.offline(since: since))
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
        // Cookie's chat opens over whatever tab is showing.
        if route == .cookie { return cookieOpen = true }
        selectedTab = route.tab
        switch route {
        case .tennis: tennisPath = []
        case .tournament, .tennisEntry, .player, .tennisResults, .tennisAccuracy: tennisPath = [route]
        case .swimming: swimmingPath = []
        case .meet, .swimEvent: swimmingPath = [route]
        case .school, .suggestions, .sources, .accounts, .settings, .videos, .notifications, .clash: morePath = [route]
        case .video: morePath = [.videos, route]
        case .mail: todayPath = [.mail]
        default: pendingRoute = route
        }
    }

    /// Opens an event on the calendar from one of Cookie's cards (intent
    /// 0008, ACT-1). The chat closes first: a sheet can't open while
    /// another is still closing.
    func openEvent(id: String, day: String) async {
        if cookieOpen {
            cookieOpen = false
            try? await Task.sleep(for: .milliseconds(500))
        }
        pendingEventDay = day
        go(.event(id: id))
    }

    // MARK: Launch time (INFR-2)

    /// Today calls this when its list first shows; only the first time
    /// after launch counts.
    func todayShown() {
        guard launchToToday == nil, let start = Self.processStart else { return }
        launchToToday = Date.now.timeIntervalSince(start)
        appCodeToToday = Date.now.timeIntervalSince(Self.appStart)
    }

    private static let processStart: Date? = {
        var info = kinfo_proc()
        var size = MemoryLayout<kinfo_proc>.stride
        var mib: [Int32] = [CTL_KERN, KERN_PROC, KERN_PROC_PID, getpid()]
        guard sysctl(&mib, 4, &info, &size, nil, 0) == 0 else { return nil }
        let t = info.kp_proc.p_starttime
        return Date(timeIntervalSince1970: TimeInterval(t.tv_sec) + TimeInterval(t.tv_usec) / 1_000_000)
    }()

    // MARK: Shared to the hub (EXT-3)

    /// The share sheet can't pick from Google Photos: it leaves the note in
    /// the app group, and the app opens New review on the Photos picker.
    func pickUpSharedReview() {
        guard phase == .signedIn else { return }
        let shared = SharedSettings(appGroup: ResponseCache.bundleAppGroup)
        guard let draft = shared.pendingPhotosReview else { return }
        shared.pendingPhotosReview = nil
        newReviewDraft = draft
        go(.videos)
    }

    // MARK: Notifications (PUSH-2..4)

    /// After sign-in and at each launch: register again if allowed, or
    /// explain and ask once (the UI tests skip the question).
    func settleNotifications() async {
        guard phase == .signedIn else { return }
        let settings = await UNUserNotificationCenter.current().notificationSettings()
        switch settings.authorizationStatus {
        case .authorized, .provisional, .ephemeral:
            UIApplication.shared.registerForRemoteNotifications()
        case .notDetermined:
            let testing = ProcessInfo.processInfo.arguments.contains("-HubUITestToken")
            if !UserDefaults.standard.bool(forKey: "askedForNotifications"), !testing { askForNotifications = true }
        default:
            break
        }
    }

    /// The owner said yes to the explanation: iOS asks.
    func enableNotifications() async {
        askForNotifications = false
        UserDefaults.standard.set(true, forKey: "askedForNotifications")
        let granted = (try? await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge])) ?? false
        if granted { UIApplication.shared.registerForRemoteNotifications() }
    }

    func declineNotifications() {
        askForNotifications = false
        UserDefaults.standard.set(true, forKey: "askedForNotifications")
    }

    func registerPush(token: String) async {
        guard phase == .signedIn else { return }
        pushProblem = nil
        do {
            notificationSettings = try await client.api.registerDevice(body: .json(.init(
                token: token,
                environment: .init(rawValue: Push.environment)!,
                topic: Bundle.main.bundleIdentifier ?? "com.jaydenguo.hub"
            ))).ok.body.json
            await offerCookieNotifications()
            await offerNewNotifications()
            await offerMailNotifications()
        } catch {
            pushProblem = HubError.from(error)?.message ?? "Couldn't turn on notifications for this phone."
        }
    }

    /// "Cookie's answer is ready" (intent 0009, ERA-3) is new: the server
    /// doesn't list it, so builds that don't know it never get it. This
    /// build turns it on once, like the other kinds' defaults.
    private func offerCookieNotifications() async {
        let key = "cookieNotificationsOffered"
        guard let settings = notificationSettings, settings.registered, !UserDefaults.standard.bool(forKey: key)
        else { return }
        UserDefaults.standard.set(true, forKey: key)
        let kinds = Set(settings.kinds.map(\.rawValue)).union(["cookie"])
        await setNotificationKinds(Array(kinds))
    }

    /// Intent 0023 (NTF-C1, NTF-T5, NTF-S1): every suggestion, his match
    /// results and his swim meets, switched on once by this build. Any of
    /// them can be switched off again in Settings → Notifications.
    private func offerNewNotifications() async {
        let offered = "newKindsOffered.0023"
        guard let settings = notificationSettings, settings.registered, !UserDefaults.standard.bool(forKey: offered)
        else { return }
        UserDefaults.standard.set(true, forKey: offered)
        let kinds = Set(settings.kinds.map(\.rawValue)).union(["suggestion", "tennis_result", "swim"])
        await setNotificationKinds(Array(kinds))
    }

    /// "Today's mail" (intent 0025, MA-4), switched on once by this build.
    private func offerMailNotifications() async {
        let offered = "newKindsOffered.0025"
        guard let settings = notificationSettings, settings.registered, !UserDefaults.standard.bool(forKey: offered)
        else { return }
        UserDefaults.standard.set(true, forKey: offered)
        let kinds = Set(settings.kinds.map(\.rawValue)).union(["mail"])
        await setNotificationKinds(Array(kinds))
    }

    func pushUnavailable() {
        pushProblem = "This build of the app can't get notifications. The TestFlight build can."
    }

    func loadNotificationSettings() async {
        notificationSettings = try? await client.api.getDeviceSettings().ok.body.json
    }

    func setNotificationKinds(_ kinds: [String]) async {
        do {
            notificationSettings = try await client.api.setDeviceKinds(body: .json(.init(
                kinds: kinds.compactMap { .init(rawValue: $0) }
            ))).ok.body.json
        } catch {
            show(HubError.from(error)?.message ?? "Couldn't save that.")
        }
    }

    /// PUSH-4: the target the extension saved, or asked for now when it
    /// couldn't (offline when the notification came).
    func openNotification(id: String?, target: String?, kind: String?) {
        if let target, let route = Push.route(target: target, kind: kind) { return go(route) }
        guard let id else { return }
        Task {
            if let text = await Push.text(id: id, client: client),
               let route = Push.route(target: text.target, kind: text.kind.rawValue) { go(route) }
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
    /// until they finish.
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

    /// Pull to refresh on Tennis (intent 0012, TPR-1, TPR-4, TPR-6): the
    /// quick check of his entries, lists and draws, followed until it's
    /// done (up to 2 minutes). A check under 5 minutes old isn't repeated;
    /// the screen's "Entries checked …" line says when it ran.
    func checkTennis() async {
        do {
            var check = try await client.api.startTennisCheck().accepted.body.json
            for _ in 0..<60 where check.status == .running {
                try await Task.sleep(for: .seconds(2))
                check = try await client.api.getTennisCheck(path: .init(id: check.id)).ok.body.json
            }
            switch check.status {
            case .failed: show(check.error ?? "Couldn't reach Tennis Canada. Try again later.")
            case .running: show("Still checking Tennis Canada; changes will show when it's done.")
            case .succeeded: break
            }
        } catch is CancellationError {
            return
        } catch {
            show(HubError.from(error)?.message ?? "Couldn't reach Tennis Canada. Try again later.")
        }
    }

    /// Syncs one source (Settings → Sources) and follows it.
    func refreshSource(id: String, name: String) async {
        await refresh(ids: [id], key: id, site: name)
    }

    /// Syncs every source that's switched on (Calendar, Settings → Sources).
    func refreshAllSources() async {
        guard let sources = try? await client.api.listSources().ok.body.json.sources else {
            show("Couldn't refresh the sources.")
            return
        }
        await refresh(ids: sources.filter(\.enabled).map(\.id), key: "all", site: "every source")
    }

    /// Starts each source's sync side by side (SYNC-2) and follows them
    /// until each has a new finished run, telling the screens as each one
    /// lands. A source synced within the hour is left alone (SYNC-5) and
    /// named, so a refresh never claims more than it did.
    private func refresh(ids: [String], key: String, site: String) async {
        guard !refreshing.contains(key) else { return }
        refreshing.insert(key)
        defer { refreshing.remove(key) }
        do {
            let before = try await client.api.listSources().ok.body.json.sources.filter { ids.contains($0.id) && $0.enabled }
            let now = Date.now
            let recent = before.filter { s in
                !s.running && (s.nextRefreshAt.flatMap(HomeTime.parse).map { $0 > now } ?? false)
            }
            let due = before.filter { s in !s.running && !recent.contains { $0.id == s.id } }
            var notStarted: Set<String> = []
            await withTaskGroup(of: String?.self) { group in
                for s in due {
                    group.addTask { [client] in
                        (try? await client.api.refreshSource(path: .init(id: s.id)).accepted) == nil ? s.id : nil
                    }
                }
                for await id in group { if let id { notStarted.insert(id) } }
            }
            let started = Set(due.map(\.id)).subtracting(notStarted)
            let failedToStart = due.filter { notStarted.contains($0.id) }.map(\.name)
            var waiting = started.union(before.filter(\.running).map(\.id))
            guard !waiting.isEmpty || !failedToStart.isEmpty else {
                show(Self.recentMessage(recent, homeTime: homeTime, everything: true))
                return
            }
            if !waiting.isEmpty { show("Refreshing from \(site). This takes a minute or two.") }
            let baseline = Dictionary(before.map { ($0.id, $0.lastRun?.id) }, uniquingKeysWith: { a, _ in a })
            let wasRunning = Set(before.filter(\.running).map(\.id))
            var failed = failedToStart
            // Ten minutes; the slowest sites take about four.
            for _ in 0..<200 where !waiting.isEmpty {
                try await Task.sleep(for: .seconds(3))
                let current = try await client.api.listSources().ok.body.json.sources
                var landed = false
                for s in current where waiting.contains(s.id) && !s.running {
                    guard wasRunning.contains(s.id) || s.lastRun?.id != baseline[s.id] ?? nil else { continue }
                    waiting.remove(s.id)
                    landed = true
                    if s.lastRun?.status == "failed" { failed.append(s.name) }
                }
                if landed { await dataChanged() }
            }
            var message = !waiting.isEmpty
                ? "Still refreshing from \(site); changes will show when it's done."
                : failed.isEmpty ? "Updated from \(site)." : "Couldn't refresh \(Self.names(failed))."
            if !recent.isEmpty { message += " " + Self.recentMessage(recent, homeTime: homeTime, everything: false) }
            show(message)
        } catch is CancellationError {
            return
        } catch {
            show(HubError.from(error)?.message ?? "Couldn't refresh from \(site).")
        }
        await dataChanged()
    }

    private static func names(_ list: [String]) -> String {
        list.count <= 1 ? list.joined() : list.dropLast().joined(separator: ", ") + " and " + list.last!
    }

    /// Sources refresh at most once an hour (SYNC-5).
    private static func recentMessage(_ recent: [SourceView], homeTime: HomeTime, everything: Bool) -> String {
        guard !recent.isEmpty else { return "Nothing to refresh." }
        let next = recent.compactMap { $0.nextRefreshAt.flatMap(HomeTime.parse) }.min()
        let after = next.map { " Try again after \(homeTime.time($0))." } ?? ""
        if everything {
            let who = recent.count == 1 ? recent[0].name : "Everything"
            return "\(who) synced within the last hour.\(after)"
        }
        let verb = recent.count == 1 ? "was" : "were"
        return "\(names(recent.map(\.name))) synced within the hour, so \(recent.count == 1 ? "it" : "they") \(verb) left as is."
    }
}

struct Toast: Identifiable, Equatable {
    let id = UUID()
    let message: String
    let undo: Undo?

    static func == (a: Toast, b: Toast) -> Bool { a.id == b.id }
}
